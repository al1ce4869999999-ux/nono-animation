"""Run with python3 tests/browser_smoke.py; requires Playwright and a browser.
Use BROWSER=webkit and PLAYWRIGHT_BROWSERS_PATH when testing installed WebKit.
"""
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
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)

rows = b''.join(b'\0' + b''.join(bytes((220, 70, 40)) if 20 < x < 80 and 20 < y < 80 else bytes((255, 255, 255)) for x in range(100)) for y in range(100))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 100, 100, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        name = os.environ.get('BROWSER', 'chromium')
        browser = getattr(p, name).launch(**({'executable_path': '/usr/bin/chromium', 'args': ['--no-sandbox']} if name == 'chromium' else {}))
        for fallback in [False, True]:
            context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
            if fallback:
                context.add_init_script('window.PointerEvent = undefined')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            def message_contains(text):
                assert text in page.locator('#message').inner_text(), page.locator('#message').inner_text()
            page.locator('#play').tap()
            message_contains('先に画像')
            page.locator('#file').set_input_files({'name': 'test.png', 'mimeType': 'image/png', 'buffer': png})
            page.wait_for_function('loaded && canvas.width === 100')
            page.locator('#play').tap()
            message_contains('選択が完了していません')
            page.locator('#select').tap()
            box = page.locator('#canvas').bounding_box()
            def event(kind, x, y):
                box = page.locator('#canvas').bounding_box()
                page.evaluate('''({kind, x, y, fallback}) => {
                  const options = {bubbles:true, cancelable:true, clientX:x, clientY:y};
                  if (fallback) {
                    const touch = new Touch({identifier:7, target:canvas, ...options});
                    canvas.dispatchEvent(new TouchEvent('touch'+kind, {
                      bubbles:true, cancelable:true, touches:kind==='end'||kind==='cancel'?[]:[touch],
                      changedTouches:[touch], targetTouches:kind==='end'||kind==='cancel'?[]:[touch]
                    }));
                  } else {
                    canvas.dispatchEvent(new PointerEvent('pointer'+({start:'down',end:'up'}[kind]||kind),
                      {...options,pointerId:7,pointerType:'touch',isPrimary:true,button:0}));
                  }
                }''', {'kind': kind, 'x': box['x'] + x * box['width'] / 100, 'y': box['y'] + y * box['height'] / 100, 'fallback': fallback})
            event('start', 15, 15)
            event('end', 15, 15)
            message_contains('範囲が選択されていません')
            assert page.evaluate('tail === null && selecting')
            event('start', 15, 15)
            event('move', 50, 50)
            event('cancel', 50, 50)
            message_contains('中断')
            assert page.evaluate('!drawing && selecting && tail === null')
            event('start', 15, 15)
            for x, y in [(85, 15), (85, 85), (15, 85)]:
                event('move', x, y)
            event('end', 15, 15)
            assert page.evaluate('tail !== null && Math.abs(tail.w-70)<=1 && choosingPivot')
            page.locator('#play').tap()
            message_contains('付け根が未指定')
            # Use a real touchscreen tap for the pivot and buttons.
            box = page.locator('#canvas').bounding_box()
            page.touchscreen.tap(box['x'] + box['width'] / 2, box['y'] + box['height'] * .8)
            assert page.evaluate('Math.abs(pivot.x-50)<1 && Math.abs(pivot.y-80)<1')
            page.locator('#play').tap()
            page.wait_for_function('playing && startTime !== null')
            first = page.evaluate('canvas.toDataURL()')
            page.wait_for_function('(performance.now()-startTime)>150')
            assert page.evaluate('canvas.toDataURL()') != first
            page.locator('#play').tap()
            message_contains('再生中')
            page.locator('#stop').tap()
            assert page.evaluate('!playing && frameId === null')
            stopped = page.evaluate('canvas.toDataURL()')
            page.wait_for_timeout(100)
            assert page.evaluate('canvas.toDataURL()') == stopped
            for _ in range(3):
                page.locator('#play').tap()
                page.locator('#stop').tap()
            assert page.evaluate('!playing && frameId === null')
            # A synchronous scheduling failure and an asynchronous drawing failure are visible.
            page.evaluate('() => {window.originalRAF=requestAnimationFrame; window.requestAnimationFrame=()=>{throw new Error("RAF test")};}')
            page.evaluate('document.getElementById("play").click()')
            message_contains('RAF test')
            assert page.evaluate('!playing')
            page.evaluate('() => {window.requestAnimationFrame=originalRAF; window.originalDraw=draw; draw=()=>{throw new Error("draw test")};}')
            page.locator('#play').tap()
            page.wait_for_function('message.textContent.includes("draw test")')
            assert page.evaluate('!playing && frameId === null')
            page.evaluate('() => {draw=originalDraw;}')
            page.locator('#select').tap()
            assert page.evaluate('tail === null && pivot === null && selecting')
            page.locator('#play').tap()
            message_contains('選択が完了していません')
            page.locator('#file').set_input_files({'name':'bad.png','mimeType':'image/png','buffer':b'invalid'})
            page.wait_for_function('message.textContent.includes("画像を読み込めません")')
            assert not errors, errors
            context.close()
            print(f'PASS {name}: mobile {"touch fallback" if fallback else "pointer"}, selection/cancel/pivot, animation/stop/restart, error messages')
        browser.close()
finally:
    server.shutdown()
    server.server_close()
