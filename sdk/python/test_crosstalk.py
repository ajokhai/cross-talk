"""
Integration tests for the Python SDK. They need a running v2 hub:

    npx tsx src/server/index.ts            # or: npm run dev
    CROSSTALK_TEST_URL=ws://127.0.0.1:4488 python3 -m unittest sdk/python/test_crosstalk.py

Both transports are tested; the WebSocket one is skipped unless
websocket-client is installed.
"""

import os
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crosstalk  # noqa: E402
from crosstalk import CrossTalk, CrossTalkError, is_address  # noqa: E402

URL = os.environ.get("CROSSTALK_TEST_URL")


class TransportTests:
    transport = ""

    def setUp(self):
        self.alice = CrossTalk.connect("Alice", url=URL, transport=self.transport)
        self.bob = CrossTalk.connect("Bob", url=URL, transport=self.transport)
        self.ch = self.alice.create_channel("pairing", topic="tests")
        self.bob_ch = self.bob.join_channel(self.ch.address)

    def tearDown(self):
        self.alice.close()
        self.bob.close()

    def test_create_and_join_by_address(self):
        self.assertTrue(is_address(self.ch.address))
        self.assertEqual(self.ch.info["visibility"], "private")
        self.assertEqual(sorted(m["name"] for m in self.bob_ch.members.values()), ["Alice", "Bob"])
        with self.assertRaises(CrossTalkError) as err:
            self.bob.join_channel("xt_" + "A" * 22)
        self.assertEqual(err.exception.code, "not_found")

    def test_wait_for_message_blocks_until_reply(self):
        threading.Timer(0.5, lambda: self.bob_ch.send("hello", {"k": 1})).start()
        message = self.alice.wait_for_message(self.ch.address, timeout=10)
        self.assertEqual(message["content"], "hello")
        self.assertEqual(message["metadata"], {"k": 1})
        self.assertIsNone(self.alice.wait_for_message(timeout=0.5))

    def test_messages_between_waits_are_not_lost(self):
        self.bob_ch.send("one")
        self.bob_ch.send("two")
        time.sleep(0.5)
        self.assertEqual(self.alice.wait_for_message(timeout=2)["content"], "one")
        self.assertEqual(self.alice.wait_for_message(timeout=2)["content"], "two")

    def test_own_messages_are_not_returned(self):
        self.ch.send("talking to myself")
        self.assertIsNone(self.alice.wait_for_message(timeout=0.5))

    def test_dm(self):
        self.bob.dm("Alice", "psst", reply_expected=False)
        message = self.alice.wait_for_message(timeout=5)
        self.assertEqual(message["content"], "psst")
        self.assertFalse(message["replyExpected"])

    def test_locks(self):
        lock = self.ch.lock(os.path.join(os.getcwd(), "src", "b.ts"), "edit", ttl=60)
        self.assertEqual(lock["file"], "src/b.ts")
        with self.assertRaises(CrossTalkError) as err:
            self.bob_ch.lock("src/b.ts", "me too")
        self.assertEqual(err.exception.code, "lock_held")
        self.ch.unlock("src/b.ts")
        self.assertEqual(self.bob_ch.lock("src/b.ts", "now")["holder"]["name"], "Bob")

    def test_malformed_event_is_reported_not_fatal(self):
        errors = []
        self.alice.on("error", errors.append)
        self.alice._dispatch({"type": "message"})          # no "message" key
        self.alice._dispatch({"type": "lock.acquired"})    # no "lock" key
        self.assertEqual([e.code for e in errors], ["bad_request", "bad_request"])
        self.bob_ch.send("still alive")
        self.assertEqual(self.alice.wait_for_message(timeout=5)["content"], "still alive")

    def test_list_status_and_leave(self):
        self.assertIn(self.ch.address, [c["id"] for c in self.alice.list_channels()["channels"]])
        self.assertNotIn(self.ch.address, [c["id"] for c in self.alice.list_channels(scope="public")["channels"]])
        self.assertEqual(self.alice.set_status("working", "testing")["status"], "working")
        self.bob_ch.leave()
        time.sleep(0.3)
        self.assertEqual(len(self.ch.refresh().members), 1)


@unittest.skipUnless(URL, "set CROSSTALK_TEST_URL to a running hub")
class HttpTransportTest(TransportTests, unittest.TestCase):
    transport = "http"


@unittest.skipUnless(URL and crosstalk.websocket, "needs CROSSTALK_TEST_URL and websocket-client")
class WebSocketTransportTest(TransportTests, unittest.TestCase):
    transport = "ws"


if __name__ == "__main__":
    unittest.main()
