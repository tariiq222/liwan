import http.client
import sys
import threading
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.ari import (  # noqa: E402
    EVENTS_APPLICATION,
    AriClient,
    AriError,
    AriListener,
    AriTransport,
    ConnectionState,
    events_url,
)


class FakeAri:
    """Answers like ARI without a socket; records every request."""

    def __init__(self, answers: dict) -> None:
        self.answers = answers
        self.requests: list[tuple] = []

    def __call__(self, method, path, params):
        self.requests.append((method, path, params))
        return self.answers.get((method, path), (204, None))


class EventsUrlTest(unittest.TestCase):
    def test_http_becomes_a_websocket_with_the_application_and_every_event(self) -> None:
        self.assertEqual(
            events_url("http://ari:8088/ari", "liwan", "secret"),
            "ws://ari:8088/ari/events?api_key=liwan%3Asecret&app=pbx-agent&subscribeAll=true",
        )

    def test_the_application_name_is_fixed(self) -> None:
        self.assertEqual(EVENTS_APPLICATION, "pbx-agent")

    def test_https_becomes_wss_and_a_trailing_slash_is_ignored(self) -> None:
        self.assertEqual(
            events_url("https://ari:8089/ari/", "liwan", "se:cr@t"),
            "wss://ari:8089/ari/events?api_key=liwan%3Ase%3Acr%40t&app=pbx-agent&subscribeAll=true",
        )


class AriClientTest(unittest.TestCase):
    def client(self, answers: dict) -> tuple[AriClient, FakeAri]:
        fake = FakeAri(answers)
        return AriClient(fake), fake

    def test_reachability_is_the_asterisk_info_call(self) -> None:
        client, fake = self.client({("GET", "/asterisk/info"): (200, {"status": "fully booted"})})
        self.assertTrue(client.reachable())
        self.assertEqual(fake.requests[0], ("GET", "/asterisk/info", None))

    def test_a_failed_probe_is_unreachable_not_an_error(self) -> None:
        def failing(_method, _path, _params):
            raise AriError("ARI GET /asterisk/info failed: TimeoutError")

        self.assertFalse(AriClient(failing).reachable())
        self.assertIsNone(AriClient(failing).endpoint_state("trunk_main"))

    def test_an_endpoint_state_is_reported_when_ari_knows_it(self) -> None:
        client, _fake = self.client({("GET", "/endpoints/PJSIP/trunk_main"): (200, {"state": "online"})})
        self.assertEqual(client.endpoint_state("trunk_main"), "online")
        missing, _fake = self.client({})
        self.assertIsNone(missing.endpoint_state("trunk_main"))

    def test_a_hangup_is_a_delete_on_the_channel(self) -> None:
        client, fake = self.client({("DELETE", "/channels/1764049999.7"): (204, None)})
        client.hangup("1764049999.7")
        self.assertEqual(fake.requests[0], ("DELETE", "/channels/1764049999.7", None))
        missing, _fake = self.client({("DELETE", "/channels/1764049999.7"): (404, None)})
        with self.assertRaises(AriError):
            missing.hangup("1764049999.7")


class AriTransportTest(unittest.TestCase):
    def transport(self) -> AriTransport:
        return AriTransport("http://ari:8088/ari", "liwan", "secret", timeout=1)

    def test_a_timeout_is_a_failed_call_not_a_crash(self) -> None:
        timeout = mock.patch.object(urllib.request, "urlopen", side_effect=TimeoutError("timed out"))
        with timeout, self.assertRaises(AriError):
            self.transport()("GET", "/asterisk/info")

    def test_a_broken_http_response_is_a_failed_call(self) -> None:
        broken = mock.patch.object(urllib.request, "urlopen", side_effect=http.client.BadStatusLine("garbage"))
        with broken, self.assertRaises(AriError):
            self.transport()("GET", "/asterisk/info")

    def test_a_refused_connection_is_a_failed_call(self) -> None:
        refused = mock.patch.object(urllib.request, "urlopen", side_effect=ConnectionRefusedError("no ari"))
        with refused, self.assertRaises(AriError):
            self.transport()("GET", "/asterisk/info")

    def test_the_error_names_the_call_and_never_the_api_key(self) -> None:
        refused = mock.patch.object(urllib.request, "urlopen", side_effect=ConnectionRefusedError("no ari"))
        with refused, self.assertRaises(AriError) as caught:
            self.transport()("GET", "/asterisk/info")
        self.assertIn("/asterisk/info", str(caught.exception))
        self.assertNotIn("secret", str(caught.exception))


class FakeSocket:
    def __init__(self, messages: list) -> None:
        self.messages = messages

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> None:
        return None

    def recv(self, timeout=None):
        if self.messages:
            return self.messages.pop(0)
        raise TimeoutError


class ListenerTest(unittest.TestCase):
    def test_events_are_parsed_and_handed_over_until_the_stop_event(self) -> None:
        stop = threading.Event()
        state = ConnectionState()
        received: list[dict] = []

        def on_event(event: dict) -> None:
            received.append(event)
            stop.set()

        messages = [
            "not json",
            '{"type": "Ping"}',
            '{"type": "ChannelCreated", "channel": {"id": "1.1"}}',
        ]

        def connect(url: str) -> FakeSocket:
            self.assertIn("api_key=", url)
            self.assertIn("app=pbx-agent", url)
            self.assertIn("subscribeAll=true", url)
            return FakeSocket(messages)

        listener = AriListener(
            url=events_url("http://ari:8088/ari", "liwan", "secret"),
            on_event=on_event,
            state=state,
            connect=connect,
        )
        listener.run_forever(stop)
        self.assertEqual(received, [{"type": "ChannelCreated", "channel": {"id": "1.1"}}])
        self.assertFalse(state.connected)

    def test_a_broken_connection_is_retried_until_the_stop_event(self) -> None:
        stop = threading.Event()
        state = ConnectionState()
        attempts = []

        def connect(_url: str):
            attempts.append(state.connected)
            if len(attempts) == 1:
                raise ConnectionRefusedError("no asterisk")
            stop.set()
            return FakeSocket([])

        listener = AriListener(
            url="ws://ari:8088/ari/events",
            on_event=lambda _event: None,
            state=state,
            connect=connect,
        )
        listener.run_forever(stop)
        self.assertEqual(len(attempts), 2)
        self.assertFalse(any(attempts))


if __name__ == "__main__":
    unittest.main()
