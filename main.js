const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

console.log("Logs from your program will appear here!");

//1 绑定到一个端口 - 解析命令行参数
const parseArguments = () => {
  let filesDir = '/tmp'; // default
  const dirFlagIndex = process.argv.indexOf('--directory');
  if (dirFlagIndex !== -1 && process.argv[dirFlagIndex + 1]) {
    filesDir = process.argv[dirFlagIndex + 1];
  }
  return filesDir;
};

// HTTP响应构建器
class HttpResponse {
  constructor(statusCode = 200, statusText = 'OK') {
    this.statusLine = `HTTP/1.1 ${statusCode} ${statusText}`;
    this.headers = {
      'Content-Type': 'text/plain'
    };
    this.body = null;
  }

  setHeader(key, value) {
    this.headers[key] = value;
  }

  setBody(body, contentType = 'text/plain') {
    this.body = body;
    this.headers['Content-Type'] = contentType;
    this.headers['Content-Length'] = Buffer.isBuffer(body) ? body.length : body.length;
  }

  compress(acceptsGzip) {
    if (acceptsGzip && this.body && !Buffer.isBuffer(this.body)) {
      this.body = zlib.gzipSync(this.body);
      this.headers['Content-Encoding'] = 'gzip';
      this.headers['Content-Length'] = this.body.length;
    }
  }

  toString() {
    let response = this.statusLine + '\r\n';
    for (const [key, value] of Object.entries(this.headers)) {
      response += `${key}: ${value}\r\n`;
    }
    response += '\r\n';
    return response;
  }
}

// HTTP请求解析器
class HttpRequest {
  constructor(rawRequest) {
    this.parseRequest(rawRequest);
  }

  parseRequest(rawRequest) {
    const lines = rawRequest.split('\r\n');
    const [requestLine, ...headerLines] = lines;
    
    // 3. 提取URL路径 - 解析请求行
    const [method, requestPath, version] = requestLine.split(' ');
    this.method = method;
    this.path = requestPath;
    this.version = version;

    //5. 读取请求头 - 解析HTTP头部
    this.headers = {};
    headerLines.forEach(line => {
      if (line.trim()) {
        const [key, ...value] = line.split(': ');
        if (key && value.length) {
          this.headers[key.toLowerCase()] = value.join(': ');
        }
      }
    });
  }

  getHeader(name) {
    return this.headers[name.toLowerCase()] || null;  }

  acceptsGzip() {
    const acceptedEncoding = this.getHeader('accept-encoding');
    return acceptedEncoding && acceptedEncoding.toLowerCase().includes('gzip');
  }

  isConnectionClose() {
    return this.getHeader('connection').toLowerCase() === 'close';
  }
}

// 路由处理器
class RequestHandler {
  constructor(filesDir) {
    this.filesDir = filesDir;
  }

  // 根路径处理
  handleRoot() {
    const response = new HttpResponse();
    response.setBody('Hello, World!');
    return response;
  }

  // Echo功能处理
  handleEcho(request) {
    const echoStr = request.path.match(/^\/echo\/(.+)$/)[1];
    const response = new HttpResponse();
    response.setBody(echoStr);
    response.compress(request.acceptsGzip());
    return response;
  }

  // User-Agent处理
  handleUserAgent(request) {
    const userAgent = request.getHeader('user-agent');
    const response = new HttpResponse();
    response.setBody(userAgent);
    response.compress(request.acceptsGzip());
    return response;
  }

  // 文件处理
  handleFiles(request) {
    const filename = request.path.match(/^\/files\/(.+)$/)[1];
    const filePath = path.join(this.filesDir, filename);

    // 安全检查：防止路径遍历攻击
    if (filename.includes('..') || filename.includes('/')) {
      return new HttpResponse(400, 'Bad Request');
    }

    if (request.method === 'GET') {
      return this.handleFileGet(filePath, request);
    } else if (request.method === 'POST') {
      return this.handleFilePost(filePath, request);
    }
  }

  // GET文件处理
  handleFileGet(filePath, request) {
    try {
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath);
        const response = new HttpResponse();
        response.setBody(fileContent, 'application/octet-stream');
        response.compress(request.acceptsGzip());
        return response;
      } else {
        const response = new HttpResponse(404, 'Not Found');
        response.setBody('File not found');
        return response;
      }
    } catch (error) {
      console.error('Error reading file:', error);
      const response = new HttpResponse(500, 'Internal Server Error');
      response.setBody('Internal server error');
      return response;
    }
  }

  // POST文件处理
  handleFilePost(filePath, request) {
    try {
      //8. 读取请求体 - POST请求处理文件上传
      const body = request.body || fs.readFileSync(request.path.match(/^\/files\/(.+)$/)[1]);
      fs.writeFileSync(filePath, body);
      const response = new HttpResponse(201, 'Created');
      response.setBody('File uploaded successfully');
      return response;
    } catch (error) {
      console.error('Error writing file:', error);
      const response = new HttpResponse(500, 'Internal Server Error');
      response.setBody('Internal server error');
      return response;
    }
  }

  // 路由分发
  handleRequest(request) {
    try {
      if (request.path === '/' || request.path === '/index.html') {
        return this.handleRoot();
      } else if (request.path.match(/^\/echo\/(.+)$/)) {
        return this.handleEcho(request);
      } else if (request.path === '/user-agent') {
        return this.handleUserAgent(request);
      } else if (request.path.match(/^\/files\/(.+)$/)) {
        return this.handleFiles(request);
      } else {
        const response = new HttpResponse(404, 'Not Found');
        response.setBody('Page not found');
        return response;
      }
    } catch (error) {
      console.error('Error handling request:', error);
      const response = new HttpResponse(500, 'Internal Server Error');
      response.setBody('Internal server error');
      return response;
    }
  }
}

// 6 支持并发连接 - 创建TCP服务器
const createServer = (filesDir) => {
  const handler = new RequestHandler(filesDir);

  return net.createServer((socket) => {
    console.log('Client connected.');

    let buffer = '';   socket.on('data', data => {
      buffer += data.toString();
      
      while (buffer.includes('\r\n\r\n')) {
        const [rawRequest, ...rest] = buffer.split('\r\n\r\n');
        buffer = rest.join('\r\n\r\n');

        try {
          const request = new HttpRequest(rawRequest);
          
          // 提取请求体
          if (rest.length > 0) {
            request.body = rest[0];
          }

          // 处理请求
          const response = handler.handleRequest(request);

          // 高级功能2: 持久连接 - 处理Connection: close头部
          if (request.isConnectionClose()) {
            response.setHeader('Connection', 'close');
          }

          //4带响应体回复 - 构建并发送HTTP响应
          const responseStr = response.toString();
          
          if (response.body && response.body.length) {
            if (Buffer.isBuffer(response.body)) {
              socket.write(responseStr);
              socket.write(response.body);
            } else {
              socket.write(responseStr + response.body);
            }
          } else {
            socket.write(responseStr);
          }

          // 高级功能2: 持久连接 - 根据Connection头部决定是否关闭连接
          if (request.isConnectionClose()) {
            socket.end();
            return;
          }
        } catch (error) {
          console.error('Error processing request:', error);
          const errorResponse = new HttpResponse(500, 'Internal Server Error');
          errorResponse.setBody('Internal server error');
          socket.write(errorResponse.toString());
          socket.end();
        }
      }
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });
};

// 主函数
const main = () => {
  const filesDir = parseArguments();
  const server = createServer(filesDir);

  //1 绑定到一个端口 - 启动服务器监听
  server.listen(4221, 'localhost', () => {
    console.log('HTTP Server running on http://localhost:4221');
    console.log(`Files directory: ${filesDir}`);
  });

  server.on('error', (error) => {
    console.error('Server error:', error);
  });
};

// 启动服务器
main(); 