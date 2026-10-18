"""Canvas/UI integration with a deterministic mask. Does NOT test model quality or iPhone hardware."""
import os
import struct
import threading
import zlib
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
def chunk(kind, data):
    return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
rows=b''.join(b'\0'+b''.join(bytes((240,20,30)) if 30<=x<70 and 20<=y<80 else bytes((180+(x%4)*10,180+(y%4)*10,200)) for x in range(100)) for y in range(100))
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',100,100,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        name=os.environ.get('BROWSER','chromium')
        browser=getattr(p,name).launch(**({'executable_path':os.environ['CHROMIUM_PATH'],'args':['--no-sandbox']} if name=='chromium' and 'CHROMIUM_PATH' in os.environ else {}))
        context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
        context.add_init_script("""
        window.modelMode='success';
        window.Worker=class {
          terminate(){this.dead=true;}
          postMessage({width,height}){
            const mode=window.modelMode;
            setTimeout(()=>{
              if(this.dead)return;
              this.onmessage({data:{type:'progress',stage:'test',progress:50}});
              if(mode==='hang')return;
              if(mode==='error'){this.onmessage({data:{type:'error',message:'offline test'}});return;}
              const mask=new Uint8Array(width*height);
              for(let y=20;y<80;y++)for(let x=30;x<70;x++)mask[y*width+x]=255;
              this.onmessage({data:{type:'result',width,height,mask:mask.buffer}});
            },20);
          }
        };
        """)
        page=context.new_page()
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.locator('#file').set_input_files({'name':'room-fixture.png','mimeType':'image/png','buffer':png})
        page.wait_for_function('mlCandidate !== null && !mlBusy')
        assert page.evaluate("""()=>{
          const c=document.getElementById('motionPreview');
          if(c.width!==100||c.height!==100)return false;
          const d=c.getContext('2d').getImageData(50,50,1,1).data;
          return d[0]===240&&d[1]===20&&d[2]===30;
        }""")
        original=page.evaluate('canvas.toDataURL()')
        assert page.evaluate('!playing && !bodyMode')
        page.locator('#play').tap()
        assert page.evaluate('!playing')
        assert page.locator('#acceptML').is_disabled()
        page.locator('#acceptEdges').check()
        assert page.locator('#acceptML').is_disabled()
        # The repaired background must not contain the red character at its original position.
        assert page.evaluate("""()=>{
          const d=mlCandidate.background.getContext('2d').getImageData(50,50,1,1).data;
          return !(d[0]>230 && d[1]<40);
        }""")
        # The foreground's RGB is copied from the source, not regenerated.
        assert page.evaluate("""()=>{
          const d=mlCandidate.foreground.getContext('2d').getImageData(50,50,1,1).data;
          return d[0]===240 && d[1]===20 && d[2]===30 && d[3]===255;
        }""")
        page.locator('#acceptBackground').check()
        page.locator('#acceptML').tap()
        page.wait_for_function('playing && startTime !== null && performance.now()-startTime>180')
        assert page.evaluate('bodyMode && canvas.toDataURL()') != original
        page.locator('#stop').tap()
        assert page.evaluate('!playing && frameId===null && canvas.toDataURL()') == original
        with page.expect_download() as dl:
            page.locator('#saveImage').tap()
        assert dl.value.suggested_filename=='nono-frame.png'
        assert Path(dl.value.path()).read_bytes().startswith(b'\x89PNG')
        with page.expect_download() as dl:
            page.locator('#saveProject').tap()
        project=Path(dl.value.path()).read_bytes()
        import json
        data=json.loads(project)
        assert data['version']==2 and data['bodyMask'].startswith('data:image/png')
        page.locator('#openProject').set_input_files({'name':'project.json','mimeType':'application/json','buffer':project})
        page.wait_for_function('mlCandidate !== null')
        assert page.evaluate('!bodyMode && !playing')
        page.locator('#acceptEdges').check()
        page.locator('#acceptBackground').check()
        page.locator('#acceptML').tap()
        page.locator('#stop').tap()
        supported=page.evaluate("""typeof canvas.captureStream==='function' && typeof MediaRecorder!=='undefined' && ['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm'].some(t=>MediaRecorder.isTypeSupported(t))""")
        page.locator('#duration').fill('1')
        if supported:
            with page.expect_download(timeout=15000) as dl:
                page.locator('#saveVideo').tap()
            assert Path(dl.value.path()).stat().st_size>0
            page.wait_for_function('!recording')
        else:
            page.locator('#saveVideo').tap()
            assert '対応' in page.locator('#message').inner_text()
        page.evaluate('window.savedRecorder=window.MediaRecorder; window.MediaRecorder=undefined')
        page.locator('#saveVideo').tap()
        assert '対応' in page.locator('#message').inner_text()
        assert page.evaluate('!recording')
        page.evaluate('() => {window.MediaRecorder=window.savedRecorder;}')
        if supported:
            page.evaluate('''() => {window.MediaRecorder=class {
              static isTypeSupported(){return true;}
              state='inactive';
              start(){this.state='recording';setTimeout(()=>this.onerror({error:new Error('recorder test failure')}),0);}
              stop(){this.state='inactive';this.onstop?.();}
            };}''')
            page.locator('#saveVideo').tap()
            page.wait_for_function('!recording && message.textContent.includes("recorder test failure")')
            assert not page.locator('#file').is_disabled()
            page.evaluate('() => {window.MediaRecorder=window.savedRecorder;}')
        page.locator('#restoreOriginal').tap()
        assert page.evaluate('!bodyMode && canvas.toDataURL()') == original
        page.evaluate("window.modelMode='error'")
        page.locator('#extractBody').tap()
        page.wait_for_function('!mlBusy && message.textContent.includes("offline test")')
        assert page.evaluate('!bodyMode && !playing && canvas.toDataURL()') == original
        page.evaluate("window.modelMode='hang'")
        page.locator('#extractBody').tap()
        page.wait_for_function('mlBusy')
        page.locator('#cancelML').tap()
        assert page.evaluate('!mlBusy && !bodyMode && canvas.toDataURL()') == original
        assert not errors,errors
        print(f'PASS {name}: deterministic mask review, foreground/background pixels, playback/stop, PNG, project roundtrip, video capability, model failure/cancel')
        context.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
