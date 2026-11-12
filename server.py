#!/usr/bin/env python3
"""
Simple HTTP Server for Jalaram Enterprise Quotation Manager PWA
Runs locally with proper MIME types for PWA manifests and Service Workers.
"""
import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8080

class PWAHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow cross-origin isolation and service worker scopes if needed
        self.send_header('Service-Worker-Allowed', '/')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.json') or path.endswith('manifest.json'):
            return 'application/manifest+json'
        if path.endswith('.js'):
            return 'application/javascript'
        if path.endswith('.svg'):
            return 'image/svg+xml'
        return super().guess_type(path)

def run():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    
    # Try PORT, if in use try PORT+1
    port = PORT
    for attempt in range(5):
        try:
            with socketserver.TCPServer(("", port), PWAHandler) as httpd:
                url = f"http://localhost:{port}"
                print("\n" + "=" * 60)
                print(f"  Jalaram Enterprise - Quotation Manager PWA")
                print("=" * 60)
                print(f"  Local URL: {url}")
                print(f"  Network/Mobile: http://<your-local-ip>:{port}")
                print("  Press Ctrl+C to stop the server.")
                print("=" * 60 + "\n")
                
                # Inform user of URL
                pass
                
                httpd.serve_forever()
                break
        except OSError as e:
            if "Address already in use" in str(e):
                port += 1
            else:
                raise e

if __name__ == '__main__':
    try:
        run()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        sys.exit(0)
