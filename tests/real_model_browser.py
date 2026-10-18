"""Network integration smoke with the actual model and an official portrait fixture.
Passing this test establishes pipeline execution only, not Nono segmentation quality.
"""
import os
import threading
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
url="https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/portrait-of-woman_small.jpg"
with urllib.request.urlopen(url,timeout=60) as response:
    fixture=response.read()
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(**({'executable_path':os.environ['CHROMIUM_PATH'],'args':['--no-sandbox']} if os.environ.get('CHROMIUM_PATH') else {}))
        page=browser.new_page()
        page.add_init_script("""
          window.workerResults=[];
          const NativeWorker=window.Worker;
          window.Worker=class extends NativeWorker {
            constructor(...args){super(...args);this.addEventListener('message',({data})=>{
              if(data.type==='result')window.workerResults.push({type:data.type,width:data.width,height:data.height,bytes:data.mask.byteLength});
              if(data.type==='error')window.workerResults.push({type:data.type,message:data.message});
            });}
          };
        """)
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.locator('#file').set_input_files({'name':'official-portrait.jpg','mimeType':'image/jpeg','buffer':fixture})
        page.wait_for_function('workerResults.length>0',timeout=180000)
        result=page.evaluate('workerResults[0]')
        assert result['type']=='result',result
        assert result['width']*result['height']==result['bytes']>0,result
        page.wait_for_function('!mlBusy')
        assert page.evaluate('!playing')
        assert page.evaluate('loaded && canvas.width>0')
        print('PASS actual Transformers.js 4.3.1 / Xenova/modnet / WASM in Chromium:',result)
        print('Pipeline smoke only; Nono, complex-room quality and iPhone hardware remain unverified.')
        browser.close()
finally:
    server.shutdown()
    server.server_close()
