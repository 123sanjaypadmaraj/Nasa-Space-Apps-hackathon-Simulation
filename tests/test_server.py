import helpers  # noqa: F401

import importlib.util
import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from pyra import evidence, server

ENGINES_READY = all(importlib.util.find_spec(f"pyra.{name}") for name in ("ranking", "gaps"))


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.make_server(evidence.load(evidence.dummy_conn()), port=0)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def get(self, path):
        with urlopen(self.base + path, timeout=10) as response:
            return response.headers.get("Content-Type"), response.read()

    def post(self, path, body):
        request = Request(self.base + path, data=json.dumps(body).encode(),
                          headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read())

    def test_investigations_come_from_the_dummy_corpus(self):
        _, body = self.get("/api/investigations")
        acronyms = [inv["acronym"] for inv in json.loads(body)]
        self.assertTrue(acronyms)

    @unittest.skipUnless(ENGINES_READY, "pyra.ranking or pyra.gaps not written yet")
    def test_coverage_returns_runs_top_five_and_gaps(self):
        found = self.post("/api/coverage", {"o2_percent": 30, "pressure": 10, "pressure_unit": "psi",
                                            "flow_speed": 10, "gravity_g": 0.16})
        self.assertEqual(found["scenario"]["label"], "HYPOTHETICAL")
        self.assertAlmostEqual(found["scenario"]["pressure"], 68.95, places=1)
        self.assertLessEqual(len(found["ranked"]), 5)
        self.assertIn("axes", found["gaps"])
        self.assertTrue(found["runs"])

    def test_static_page_is_served(self):
        content_type, body = self.get("/")
        self.assertTrue(content_type.startswith("text/html"))
        self.assertIn(b"PYRA", body)
        content_type, _ = self.get("/app.js")
        self.assertIn("javascript", content_type)

    def test_files_outside_the_web_folder_are_refused(self):
        with self.assertRaises(HTTPError) as caught:
            self.get("/../server.py")
        caught.exception.close()
        self.assertEqual(caught.exception.code, 404)

    def test_bad_json_is_a_400_with_a_reason(self):
        request = Request(self.base + "/api/coverage", data=b"{not json")
        with self.assertRaises(HTTPError) as caught:
            urlopen(request, timeout=10)
        self.assertEqual(caught.exception.code, 400)
        self.assertIn("not valid JSON", json.loads(caught.exception.read())["error"])
        caught.exception.close()

    def test_missing_engine_is_a_503_naming_it(self):
        with self.assertRaises(server.MissingModule) as caught:
            server.engine("no_such_engine")
        self.assertIn("pyra.no_such_engine", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
