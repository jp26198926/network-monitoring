const http = require("http");

const PORT = Number(process.env.PORT) || 3000;

const HOST = process.env.HOST || "0.0.0.0";

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html",
  });

  res.end(`
                <!DOCTYPE html>

                <html>

                <head>

                    <title>
                        My Web App
                    </title>

                </head>

                <body>

                    <h1>
                        Hello from Web App
                    </h1>

                    <p>
                        Host:
                        ${HOST}
                    </p>

                    <p>
                        Port:
                        ${PORT}
                    </p>

                </body>

                </html>
            `);
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
