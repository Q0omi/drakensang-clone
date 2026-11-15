# Jednoduchý lokálny server pre Kroniky Popola (správne MIME typy pre .js moduly a .glb)
import http.server, socketserver, os, sys, webbrowser, threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
                      '.gltf': 'model/gltf+json', '.png': 'image/png', '.html': 'text/html; charset=utf-8'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), Handler) as httpd:
    url = f'http://localhost:{PORT}/'
    print(f'Kroniky Popola beží na {url}  (zastavíš Ctrl+C)')
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    httpd.serve_forever()
