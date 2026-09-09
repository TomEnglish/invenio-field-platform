#!/usr/bin/env python3
"""Serve a built web export with a local, isolated Supabase fixture.
Run after the CI-placeholder Expo export. No real credentials or data are used.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import base64, json, time, re
from urllib.parse import urlparse, unquote
ROOT = Path(__file__).resolve().parents[2] / 'dist-ci'
USER_ID = 'a1111111-1111-4111-8111-111111111111'
PROJECT_ID = 'b1111111-1111-4111-8111-111111111111'
USER = dict(id=USER_ID, email='field@example.test', full_name='Field Fixture', role='field_worker', is_active=True, invitation_status='accepted', aud='authenticated', created_at='2026-09-09T12:00:00Z')
PROJECTS = [dict(id=PROJECT_ID, name='North Yard', status='active'), dict(id='b2222222-2222-4222-8222-222222222222', name='South Yard', status='active')]
def token():
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    return encode({'alg':'HS256','typ':'JWT'}) + '.' + encode({'sub':USER_ID,'aud':'authenticated','exp':int(time.time())+3600}) + '.fixture'
class Handler(SimpleHTTPRequestHandler):
    def reply(self, payload, status=200):
        body=json.dumps(payload).encode();self.send_response(status)
        self.send_header('Content-Type','application/json');self.send_header('Access-Control-Allow-Origin','*');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_OPTIONS(self):
        self.send_response(204);self.send_header('Access-Control-Allow-Origin','*');self.send_header('Access-Control-Allow-Headers','*');self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS');self.end_headers()
    def do_POST(self):
        if urlparse(self.path).path == '/auth/v1/token':
            return self.reply(dict(access_token=token(),token_type='bearer',refresh_token='fixture-refresh',expires_in=3600,expires_at=int(time.time())+3600,user=USER))
        return self.reply({'message':'Fixture writes are disabled'},403)
    def do_GET(self):
        path=unquote(urlparse(self.path).path)
        if path=='/auth/v1/user':return self.reply(USER)
        if path.startswith('/rest/v1/'):
            table=path.split('/')[-1]
            return self.reply(USER if table=='users' else [{'projects':p} for p in PROJECTS] if table=='user_projects' else [])
        file=ROOT / path.lstrip('/')
        if path=='/':file=ROOT/'index.html'
        if not file.is_file():file=ROOT/(path.lstrip('/')+'.html')
        if not file.is_file():return self.send_error(404)
        if not file.resolve().is_relative_to(ROOT.resolve()):return self.send_error(404)
        data=file.read_bytes()
        if file.suffix=='.js':
            hosts=set(re.findall(rb'https://[a-zA-Z0-9.-]+\.supabase\.co',data))
            if hosts - {b'https://example.supabase.co'}:return self.send_error(500,'Rebuild the CI placeholder export with --clear before testing')
            data=data.replace(b'https://example.supabase.co',b'http://127.0.0.1:8093')
        if file.suffix=='.html':
            queue=[dict(id='e1111111-1111-4111-8111-111111111111',userId=USER_ID,projectId=PROJECT_ID,action={'type':'receiving','payload':{}},createdAt='2026-09-09T12:00:00Z',retryCount=5,deadLetter=True,lastError='Fixture: photo upload interrupted')]
            seed='<script>if(!localStorage.getItem("field-fixture-seeded")){localStorage.setItem("offline_queue",'+json.dumps(json.dumps(queue))+');localStorage.setItem("field-fixture-seeded","1");}</script>'
            data=data.replace(b'</head>',seed.encode()+b'</head>')
        self.send_response(200);self.send_header('Content-Type',self.guess_type(str(file)));self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
if __name__=='__main__':
    print('Field fixture: http://127.0.0.1:8093 — sign in as field@example.test with any nonempty password',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8093),Handler).serve_forever()
