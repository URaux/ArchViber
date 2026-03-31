"""
Vibe Pencil E2E — 5-round conversation iteration test with visible browser
"""
import time
import os
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:3000"
SCREENSHOTS_DIR = "tests/screenshots/multi-round"
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

def log(msg):
    ts = time.strftime('%H:%M:%S')
    # Avoid encoding issues on Windows
    try:
        print(f"[{ts}] {msg}")
    except UnicodeEncodeError:
        print(f"[{ts}] {msg.encode('ascii', 'replace').decode()}")

def wait_for_ai_response(page, timeout_s=150):
    """Wait until AI finishes responding (spinner disappears or nodes appear)"""
    start = time.time()
    last_node_count = 0
    stable_count = 0

    while time.time() - start < timeout_s:
        page.wait_for_timeout(3000)

        # Check if still sending (look for spinner in chat)
        spinners = page.locator(".vp-spinner").count()
        node_count = page.locator(".react-flow__node").count()

        elapsed = int(time.time() - start)
        log(f"  [{elapsed}s] spinners={spinners}, nodes={node_count}")

        # If node count stabilized and no spinners, we're done
        if node_count > 0 and spinners == 0:
            stable_count += 1
            if stable_count >= 2:  # Stable for 6s
                return True
        else:
            stable_count = 0

        if node_count != last_node_count:
            last_node_count = node_count

    return False

def send_message(page, text):
    """Type and send a message in the chat panel"""
    input_box = page.locator("input[placeholder*='输入'], input[placeholder*='Type'], input[placeholder*='消息'], input[placeholder*='message']").first
    input_box.fill(text)
    page.wait_for_timeout(300)
    send_btn = page.locator("button:has-text('发送')").or_(page.locator("button:has-text('Send')")).first
    send_btn.click()

def test_multi_round():
    with sync_playwright() as p:
        # Use headed mode so user can see
        browser = p.chromium.launch(headless=False)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        log("Navigating and clearing state...")
        page.goto(BASE_URL)
        page.wait_for_timeout(2000)
        page.evaluate("window.localStorage.clear()")
        page.reload()
        page.wait_for_timeout(2000)

        results = []

        # ====== ROUND 1: Initial architecture ======
        log("ROUND 1: Create initial architecture")

        # Open chat panel — click the toggle until input is visible
        for attempt in range(3):
            chat_btn = page.locator("text=AI 对话").or_(page.locator("text=AI Chat"))
            if chat_btn.count() > 0:
                chat_btn.first.click()
                page.wait_for_timeout(1000)
            input_check = page.locator("input[placeholder*='输入'], input[placeholder*='Type']")
            if input_check.count() > 0 and input_check.first.is_visible():
                log(f"  Chat panel opened (attempt {attempt+1})")
                break
            log(f"  Chat panel not ready, retrying... (attempt {attempt+1})")

        send_message(page, "帮我设计一个简单的在线书店系统，需要用户浏览图书、购物车和订单管理")
        log("  Message sent, waiting for AI...")

        r1 = wait_for_ai_response(page)
        page.screenshot(path=f"{SCREENSHOTS_DIR}/round1.png")
        nodes_r1 = page.locator(".react-flow__node").count()
        edges_r1 = page.locator(".react-flow__edge").count()
        results.append(("Round 1: Initial arch", r1 and nodes_r1 > 0, f"nodes={nodes_r1} edges={edges_r1}"))
        log(f"  Result: {'PASS' if r1 and nodes_r1 > 0 else 'FAIL'} — nodes={nodes_r1}, edges={edges_r1}")

        # ====== ROUND 2: Add feature ======
        log("ROUND 2: Add search feature")
        send_message(page, "加上图书搜索功能，要支持按书名和作者搜索")

        r2 = wait_for_ai_response(page)
        page.screenshot(path=f"{SCREENSHOTS_DIR}/round2.png")
        nodes_r2 = page.locator(".react-flow__node").count()
        results.append(("Round 2: Add search", r2, f"nodes before={nodes_r1} after={nodes_r2}"))
        log(f"  Result: {'PASS' if r2 else 'FAIL'} — nodes={nodes_r2}")

        # ====== ROUND 3: Modify existing ======
        log("ROUND 3: Modify architecture")
        send_message(page, "把数据库从单一数据库拆分成两个：一个存用户数据，一个存图书和订单数据")

        r3 = wait_for_ai_response(page)
        page.screenshot(path=f"{SCREENSHOTS_DIR}/round3.png")
        nodes_r3 = page.locator(".react-flow__node").count()
        results.append(("Round 3: Split DB", r3, f"nodes={nodes_r3}"))
        log(f"  Result: {'PASS' if r3 else 'FAIL'} — nodes={nodes_r3}")

        # ====== ROUND 4: Add integration ======
        log("ROUND 4: Add payment")
        send_message(page, "加上支付功能，接入支付宝和微信支付")

        r4 = wait_for_ai_response(page)
        page.screenshot(path=f"{SCREENSHOTS_DIR}/round4.png")
        nodes_r4 = page.locator(".react-flow__node").count()
        results.append(("Round 4: Add payment", r4, f"nodes={nodes_r4}"))
        log(f"  Result: {'PASS' if r4 else 'FAIL'} — nodes={nodes_r4}")

        # ====== ROUND 5: Review architecture ======
        log("ROUND 5: Review and finalize")
        send_message(page, "帮我review一下当前的架构，有什么问题需要改进的吗")

        r5 = wait_for_ai_response(page)
        page.screenshot(path=f"{SCREENSHOTS_DIR}/round5.png")
        nodes_r5 = page.locator(".react-flow__node").count()
        results.append(("Round 5: Review", r5, f"nodes={nodes_r5}"))
        log(f"  Result: {'PASS' if r5 else 'FAIL'} — nodes={nodes_r5}")

        # ====== Check session title ======
        page.wait_for_timeout(5000)
        sidebar_titles = page.locator(".truncate").all_text_contents()
        meaningful = [t for t in sidebar_titles if t and t != "未命名" and len(t) > 2]
        results.append(("Session title", len(meaningful) > 0, f"titles={meaningful[:3]}"))

        # ====== Check progress widget ======
        progress_text = page.locator("text=/\\d+%/").all_text_contents()
        results.append(("Progress widget", len(progress_text) > 0, f"progress={progress_text[:3]}"))

        # ====== Final screenshot ======
        page.screenshot(path=f"{SCREENSHOTS_DIR}/final.png")

        # ====== Export PNG test ======
        log("Testing PNG export...")
        export_btn = page.locator("button:has-text('导出')").first
        export_btn.click()
        page.wait_for_timeout(500)
        png_btn = page.locator("text=PNG").first
        if png_btn.count() > 0:
            with page.expect_download() as download_info:
                png_btn.click()
            # download = download_info.value
            results.append(("PNG export", True, "download triggered"))
        else:
            results.append(("PNG export", False, "PNG button not found"))
        page.wait_for_timeout(1000)

        # ====== Build All dialog test ======
        log("Testing Build All dialog...")
        build_btn = page.locator("button:has-text('全部构建')").or_(page.locator("button:has-text('Build All')")).or_(page.locator("button:has-text('构建')"))
        if build_btn.count() > 0:
            build_btn.first.click()
            page.wait_for_timeout(1000)
            page.screenshot(path=f"{SCREENSHOTS_DIR}/build-dialog.png")

            # Check dialog appeared
            # Dialog renders via Portal to body — search the whole page
            dialog = page.locator("text=构建计划").or_(page.locator("text=Build Plan")).or_(page.locator(".vp-dialog-backdrop"))
            results.append(("Build dialog", dialog.count() > 0, f"dialog visible: {dialog.count() > 0}"))

            # Close dialog
            cancel_btn = page.locator("button:has-text('取消')").or_(page.locator("button:has-text('Cancel')"))
            if cancel_btn.count() > 0:
                cancel_btn.first.click()
        else:
            results.append(("Build dialog", False, "Build button not found"))

        # Keep browser open for user inspection
        log("Test complete. Browser stays open — close it manually when done.")
        log("Press Ctrl+C in terminal to exit.")
        try:
            page.wait_for_timeout(600000)  # 10 minutes
        except Exception:
            pass

        browser.close()

        # Print report
        print("\n" + "="*60)
        print("MULTI-ROUND E2E TEST RESULTS")
        print("="*60)
        for name, passed, detail in results:
            icon = "PASS" if passed else "FAIL"
            print(f"{'[OK]' if passed else '[!!]'} {name}: {icon} — {detail}")

        total = len(results)
        ok = sum(1 for _, p, _ in results if p)
        print(f"\n{ok}/{total} passed")
        print(f"Screenshots: {SCREENSHOTS_DIR}/")

if __name__ == "__main__":
    test_multi_round()
