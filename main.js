// DNS 服务器主程序，支持 UDP 查询转发，含详细中文注释
const dgram = require('dgram');
const process = require('process');

// 全局状态，存储问题和答案
const state = {
    questions: [],
    answers: [],
};

/**
 * 构建 DNS 答案部分
 * @param {Array} answers
 * @returns {Buffer}
 */
function constructAnswers(answers) {
    const bufferArray = [];
    for (const answer of answers) {
        bufferArray.push(encodeHost(answer.questionName));
        const answerType = Buffer.alloc(2);
        answerType.writeUInt16BE(answer.answerType, 0);
        bufferArray.push(answerType);
        const answerClass = Buffer.alloc(2);
        answerClass.writeUInt16BE(answer.answerClass, 0);
        bufferArray.push(answerClass);
        const answerTtl = Buffer.alloc(4);
        answerTtl.writeUInt32BE(answer.answerTtl, 0);
        bufferArray.push(answerTtl);
        const answerLength = Buffer.alloc(2);
        answerLength.writeUInt16BE(4, 0);
        bufferArray.push(answerLength);
        bufferArray.push(answer.answerData);
    }
    return Buffer.concat(bufferArray);
}

/**
 * 构建单个 DNS 问题部分
 * @param {Object} question
 * @returns {Buffer[]}
 */
function constructQuestion(question) {
    const bufferArray = [];
    const questionName = encodeHost(question.questionName);
    bufferArray.push(questionName);
    const questionType = Buffer.alloc(2);
    questionType.writeUInt16BE(1, 0);
    bufferArray.push(questionType);
    const questionClass = Buffer.alloc(2);
    questionClass.writeUInt16BE(1, 0);
    bufferArray.push(questionClass);
    return bufferArray;
}

/**
 * 构建所有 DNS 问题部分
 * @param {Array} questions
 * @returns {Buffer}
 */
function constructQuestions(questions) {
    const bufferArray = [];
    for (const question of questions) {
        const questionBuffer = constructQuestion(question);
        bufferArray.push(...questionBuffer);
    }
    return Buffer.concat(bufferArray);
}

/**
 * 构建 DNS 请求头部
 * @param {number} packetIdentifier
 * @returns {Buffer}
 */
function constructRequestHeader(packetIdentifier) {
    const buffer = Buffer.alloc(12);
    buffer.writeUInt16BE(packetIdentifier, 0); // 标识符
    let flags = 0;
    flags |= 0 << 15; // 查询/响应
    flags |= 0 << 11; // 操作码
    flags |= 0 << 10; // 授权应答
    flags |= 0 << 9;  // 截断
    flags |= 0 << 8;  // 期望递归
    flags |= 0 << 7;  // 可用递归
    flags |= 0 << 4;  // 保留
    flags |= 0;       // 响应码
    buffer.writeUInt16BE(flags, 2);
    buffer.writeUInt16BE(1, 4); // 问题数
    buffer.writeUInt16BE(0, 6); // 答案数
    buffer.writeUInt16BE(0, 8); // 授权数
    buffer.writeUInt16BE(0, 10);// 附加数
    return buffer;
}

/**
 * 构建 DNS 响应头部
 * @param {Object} header
 * @returns {Buffer}
 */
function constructResponseHeader(header) {
    const buffer = Buffer.alloc(12);
    buffer.writeUInt16BE(header.packetIdentifier, 0);
    let flags = 0;
    flags |= 1 << 15; // 响应
    flags |= header.operationCode << 11;
    flags |= 0 << 10;
    flags |= 0 << 9;
    flags |= header.recursionDesired << 8;
    flags |= 0 << 7;
    flags |= 0 << 4;
    flags |= header.operationCode === 0 ? 0 : 4 << 0;
    buffer.writeUInt16BE(flags, 2);
    buffer.writeUInt16BE(header.questionCount, 4);
    buffer.writeUInt16BE(header.questionCount, 6);
    buffer.writeUInt16BE(0, 8);
    buffer.writeUInt16BE(0, 10);
    return buffer;
}

/**
 * 解析 DNS 头部
 * @param {Buffer} buffer
 * @param {number} offset
 * @returns {Object}
 */
function parseHeader(buffer, offset) {
    const packetIdentifier = buffer.readUInt16BE(offset);
    const thirdByte = buffer.readUInt8(offset + 2);
    const queryOrResponseIndicator = (thirdByte >> 7) & 0x01;
    const operationCode = (thirdByte >> 3) & 0x0f;
    const authoritativeAnswer = (thirdByte >> 2) & 0x01;
    const truncation = (thirdByte >> 1) & 0x01;
    const recursionDesired = thirdByte & 0x01;
    const fourthByte = buffer.readUInt8(offset + 3);
    const recursionAvailable = (fourthByte >> 7) & 0x01;
    const reserved = (fourthByte >> 4) & 0x07;
    const responseCode = fourthByte & 0x0f;
    const questionCount = buffer.readUInt16BE(offset + 4);
    const answerRecordCount = buffer.readUInt16BE(offset + 6);
    const authorityRecordCount = buffer.readUInt16BE(offset + 8);
    const additionalRecordCount = buffer.readUInt16BE(offset + 10);
    return {
        packetIdentifier,
        queryOrResponseIndicator,
        operationCode,
        authoritativeAnswer,
        truncation,
        recursionDesired,
        recursionAvailable,
        reserved,
        responseCode,
        questionCount,
        answerRecordCount,
        authorityRecordCount,
        additionalRecordCount,
    };
}

/**
 * 解析 DNS 压缩指针（RFC 1035）
 * @param {Buffer} buffer
 * @param {number} pointerOffset
 * @returns {string[]}
 */
function resolvePointer(buffer, pointerOffset) {
    let cursor = pointerOffset;
    const nameParts = [];
    while (true) {
        const len = buffer[cursor];
        if (len === 0) break;
        // 检查是否为指针（高两位为 11）
        if ((len & 0xC0) === 0xC0) {
            const nextPointer = ((len & 0x3F) << 8) | buffer[cursor + 1];
            nameParts.push(...resolvePointer(buffer, nextPointer));
            break;
        } else {
            nameParts.push(buffer.subarray(cursor + 1, cursor + 1 + len).toString());
            cursor += 1 + len;
        }
    }
    return nameParts;
}

/**
 * 解析 DNS 问题部分，支持压缩指针
 * @param {Buffer} buffer
 * @param {number} offset
 * @param {number} questionCount
 * @returns {{questions: Array, offset: number}}
 */
function parseQuestions(buffer, offset, questionCount) {
    const questions = [];
    let cursor = offset;
    for (let i = 0; i < questionCount; i++) {
        let nameParts = [];
        while (true) {
            const len = buffer[cursor];
            // 检查是否为指针
            if ((len & 0xC0) === 0xC0) {
                const pointer = ((len & 0x3F) << 8) | buffer[cursor + 1];
                nameParts.push(...resolvePointer(buffer, pointer));
                cursor += 2;
                break;
            } else if (len === 0) {
                cursor += 1;
                break;
            } else {
                nameParts.push(buffer.subarray(cursor + 1, cursor + 1 + len).toString());
                cursor += 1 + len;
            }
        }
        const questionType = buffer.readUInt16BE(cursor);
        cursor += 2;
        const questionClass = buffer.readUInt16BE(cursor);
        cursor += 2;
        questions.push({
            questionName: nameParts.join('.'),
            questionType,
            questionClass,
        });
    }
    return { questions, offset: cursor };
}

/**
 * 转发 DNS 查询到上游服务器
 */
function queryForwardingDnsServer(querySocket, questions, forwardingDnsAddress, forwardingDnsPort) {
    for (const question of questions) {
        const packetIdentifier = Math.floor(Math.random() * 65536);
        console.log(
            `[${packetIdentifier}] - Querying ${forwardingDnsAddress}:${forwardingDnsPort}: ${question.questionName}`,
        );
        const requestHeader = constructRequestHeader(packetIdentifier);
        const requestQuestion = Buffer.concat(constructQuestion(question));
        const request = Buffer.concat([requestHeader, requestQuestion]);
        querySocket.send(request, forwardingDnsPort, forwardingDnsAddress);
    }
}

/**
 * 解析 DNS 答案部分（仅简单实现）
 */
function parseAnswer(response, offset) {
    const buffer = response.subarray(offset);
    let cursor = 0;
    let nameParts = [];
    while (true) {
        const len = buffer[cursor];
        if ((len & 0xC0) === 0xC0) {
            const pointer = ((len & 0x3F) << 8) | buffer[cursor + 1];
            nameParts.push(...resolvePointer(buffer, pointer));
            cursor += 2;
            break;
        } else if (len === 0) {
            cursor += 1;
            break;
        } else {
            nameParts.push(buffer.subarray(cursor + 1, cursor + 1 + len).toString());
            cursor += 1 + len;
        }
    }
    const questionName = nameParts.join('.');
    const answerType = buffer.readUInt16BE(cursor);
    cursor += 2;
    const answerClass = buffer.readUInt16BE(cursor);
    cursor += 2;
    const answerTtl = buffer.readUInt32BE(cursor);
    cursor += 4;
    const answerLength = buffer.readUInt16BE(cursor);
    cursor += 2;
    const answerData = buffer.subarray(cursor, cursor + answerLength);
    return {
        questionName,
        answerType,
        answerClass,
        answerTtl,
        answerLength,
        answerData,
    };
}

/**
 * 启动 DNS 服务器
 */
function startServer(udpSocket, querySocket, address, port, forwardingDnsAddress, forwardingDnsPort) {
    udpSocket.bind(port, address);
    querySocket.on('message', (incomingMessage, rinfo) => {
        const header = parseHeader(incomingMessage, 0);
        const {questions, offset} = parseQuestions(incomingMessage, 12, header.questionCount);
        const answer = parseAnswer(incomingMessage, offset);
        console.log('Query socket', {header, questions, answer});
        state.answers.push(answer);
    });
    querySocket.on('error', (err) => {
        console.log(`Query socket error: ${err}`);
    });
    udpSocket.on('message', (incomingMessage, rinfo) => {
        const header = parseHeader(incomingMessage, 0);
        console.log('Main socket', header);
        const {questions, offset} = parseQuestions(incomingMessage, 12, header.questionCount);
        queryForwardingDnsServer(querySocket, questions, forwardingDnsAddress, forwardingDnsPort);
        const intervalId = setInterval(() => {
            if (state.answers.length > 0) {
                console.log('Replying back to client');
                clearInterval(intervalId);
                const response = Buffer.concat([
                    constructResponseHeader(header),
                    constructQuestions(questions),
                    constructAnswers(state.answers),
                ]);
                udpSocket.send(response, rinfo.port, rinfo.address);
                state.answers = [];
            }
        }, 100);
    });
    udpSocket.on('error', (err) => {
        console.log(`Error: ${err}`);
    });
    udpSocket.on('listening', () => {
        const address = udpSocket.address();
        console.log({text: `Server listening on ${address.address}:${address.port}`});
    });
}

// 解析命令行参数，启动服务器
const parameters = process.argv.slice(2);
const udpSocket = dgram.createSocket('udp4');
const querySocket = dgram.createSocket('udp4');
const [, forwardingAddressAndPort] = parameters;
const [forwardingAddress, forwardingPortAsString] = forwardingAddressAndPort.split(':');
startServer(udpSocket, querySocket, '127.0.0.1', 2053, forwardingAddress, Number(forwardingPortAsString));

// 工具函数：编码字符串为 DNS 格式
function encodeString(value) {
    const lengthBuffer = Buffer.alloc(1);
    lengthBuffer.writeUInt8(value.length);
    const valueBuffer = Buffer.from(value, 'ascii');
    return Buffer.concat([lengthBuffer, valueBuffer]);
}
// 工具函数：编码数字
function encodeNumber(value) {
    return Buffer.from(value);
}
// 工具函数：编码主机名为 DNS 格式
function encodeHost(host) {
    if (!host) {
        return Buffer.from([0x00]);
    }
    const parts = host.split('.');
    const encodedParts = parts.map(encodeString);
    return Buffer.concat([...encodedParts, Buffer.from([0x0])]);
}
// 工具函数：编码 IP 地址
function encodeIpAddress(ipAddress) {
    const parts = ipAddress.split('.');
    const encodedParts = parts.map(encodeNumber);
    return Buffer.concat([...encodedParts]);
}