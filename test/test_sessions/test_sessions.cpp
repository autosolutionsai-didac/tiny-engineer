#include <cstdio>
#include <cstring>
#include <unity.h>

#include "sessions/arbiter.h"
#include "sessions/led_bar.h"
#include "sessions/session_table.h"

namespace {

SessionTable table;
ArbiterState arb;

void setUp_() {
  sessionTableInit(table);
  arbiterInit(arb);
}

int put(const char* id, SessionState st, uint32_t now,
        bool hasAct = false, SessionActivity act = SessionActivity::Thinking,
        SessionSource src = SessionSource::Rest) {
  SessionUpdate u = {};
  u.id = id;
  u.state = st;
  u.hasActivity = hasAct;
  u.activity = act;
  return sessionTableApply(table, u, src, now);
}

ArbiterDecision eval(uint32_t now, ArbiterTarget current = ArbiterTarget::None) {
  return arbiterEvaluate(arb, table, current, now);
}

}  // namespace

void setUp() { setUp_(); }
void tearDown() {}

// ---- validation ----

void test_validate_id() {
  TEST_ASSERT_TRUE(sessionValidateId("a"));
  TEST_ASSERT_TRUE(sessionValidateId("claude-code:abc_1.2"));
  TEST_ASSERT_TRUE(sessionValidateId("0123456789012345678901234567890123456789"));
  TEST_ASSERT_FALSE(sessionValidateId("01234567890123456789012345678901234567890"));
  TEST_ASSERT_FALSE(sessionValidateId(""));
  TEST_ASSERT_FALSE(sessionValidateId(nullptr));
  TEST_ASSERT_FALSE(sessionValidateId("a b"));
  TEST_ASSERT_FALSE(sessionValidateId("a/b"));
}

void test_validate_agent_label() {
  TEST_ASSERT_TRUE(sessionValidateAgent(""));
  TEST_ASSERT_TRUE(sessionValidateAgent("claude-code"));
  TEST_ASSERT_TRUE(sessionValidateAgent("abcdefghijklmnop"));
  TEST_ASSERT_FALSE(sessionValidateAgent("abcdefghijklmnopq"));
  TEST_ASSERT_FALSE(sessionValidateAgent("Cursor"));
  TEST_ASSERT_FALSE(sessionValidateAgent("a_b"));
  TEST_ASSERT_TRUE(sessionValidateLabel(""));
  TEST_ASSERT_TRUE(sessionValidateLabel("my project \"x\""));
  TEST_ASSERT_TRUE(sessionValidateLabel("123456789012345678901234"));
  TEST_ASSERT_FALSE(sessionValidateLabel("1234567890123456789012345"));
  TEST_ASSERT_FALSE(sessionValidateLabel("tab\there"));
}

void test_parse_state_activity() {
  SessionState s;
  TEST_ASSERT_TRUE(sessionParseState("idle", s));
  TEST_ASSERT_TRUE(s == SessionState::Idle);
  TEST_ASSERT_TRUE(sessionParseState("working", s));
  TEST_ASSERT_TRUE(sessionParseState("waiting", s));
  TEST_ASSERT_TRUE(sessionParseState("error", s));
  TEST_ASSERT_TRUE(sessionParseState("ended", s));
  TEST_ASSERT_TRUE(s == SessionState::Ended);
  TEST_ASSERT_FALSE(sessionParseState("busy", s));
  TEST_ASSERT_FALSE(sessionParseState(nullptr, s));
  SessionActivity a;
  TEST_ASSERT_TRUE(sessionParseActivity("typing", a));
  TEST_ASSERT_TRUE(a == SessionActivity::Typing);
  TEST_ASSERT_TRUE(sessionParseActivity("reading", a));
  TEST_ASSERT_TRUE(sessionParseActivity("thinking", a));
  TEST_ASSERT_FALSE(sessionParseActivity("writing", a));
}

void test_sanitize() {
  char out[SESSION_LABEL_MAX_LEN + 1];
  sessionSanitizeAgent("Codex_CLI!", out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("codex-cli", out);
  sessionSanitizeLabel("caf\xC3\xA9-project-with-a-long-name", out, sizeof(out));
  TEST_ASSERT_TRUE(sessionValidateLabel(out));
  TEST_ASSERT_EQUAL_STRING("caf?-project-with-a-long", out);
  char id[SESSION_ID_MAX_LEN + 1];
  TEST_ASSERT_TRUE(sessionSanitizeId("a b/c", id, sizeof(id)));
  TEST_ASSERT_EQUAL_STRING("a_b_c", id);
  TEST_ASSERT_FALSE(sessionSanitizeId("", id, sizeof(id)));
}

// ---- table ----

void test_table_slots_stable_and_ended_removes() {
  TEST_ASSERT_EQUAL(0, put("a", SessionState::Idle, 10));
  TEST_ASSERT_EQUAL(1, put("b", SessionState::Idle, 20));
  TEST_ASSERT_EQUAL(0, put("a", SessionState::Working, 30));
  TEST_ASSERT_EQUAL(0, put("a", SessionState::Ended, 40));
  TEST_ASSERT_EQUAL(1, sessionTableCount(table));
  TEST_ASSERT_EQUAL(0, put("c", SessionState::Idle, 50));  // reuses free slot
  TEST_ASSERT_EQUAL(-1, put("zzz", SessionState::Ended, 60));
}

void test_table_eviction_oldest_idle() {
  char id[8];
  for (int i = 0; i < 8; i++) {
    snprintf(id, sizeof(id), "s%d", i);
    put(id, i == 2 || i == 5 ? SessionState::Idle : SessionState::Working,
        100 + i * 10);
  }
  TEST_ASSERT_EQUAL(8, sessionTableCount(table));
  // s2 is the oldest idle one -> evicted, new session takes slot 2.
  TEST_ASSERT_EQUAL(2, put("new", SessionState::Working, 500));
  TEST_ASSERT_EQUAL(-1, sessionTableFind(table, "s2"));
  TEST_ASSERT_EQUAL(5, sessionTableFind(table, "s5"));
  TEST_ASSERT_EQUAL(8, sessionTableCount(table));
}

void test_table_eviction_no_idle_falls_back_to_least_recent() {
  char id[8];
  for (int i = 0; i < 8; i++) {
    snprintf(id, sizeof(id), "w%d", i);
    put(id, SessionState::Working, 100 + i * 10);
  }
  put("w0", SessionState::Working, 900);  // refresh w0; w1 now least recent
  TEST_ASSERT_EQUAL(1, put("new", SessionState::Waiting, 1000));
  TEST_ASSERT_EQUAL(-1, sessionTableFind(table, "w1"));
}

void test_table_reap_30_min() {
  put("old", SessionState::Working, 1000);
  put("live", SessionState::Working, 1000);
  put("live", SessionState::Working, 1000 + 25UL * 60UL * 1000UL);  // keepalive
  TEST_ASSERT_EQUAL(0, sessionTableReap(table, 1000 + SESSION_REAP_MS - 1, SESSION_REAP_MS));
  TEST_ASSERT_EQUAL(1, sessionTableReap(table, 1000 + SESSION_REAP_MS, SESSION_REAP_MS));
  TEST_ASSERT_EQUAL(-1, sessionTableFind(table, "old"));
  TEST_ASSERT_TRUE(sessionTableFind(table, "live") >= 0);
}

void test_table_clear_and_replace_source() {
  put("r1", SessionState::Idle, 10, false, SessionActivity::Thinking, SessionSource::Rest);
  put("d1", SessionState::Idle, 10, false, SessionActivity::Thinking, SessionSource::AgentDeck);
  put("d2", SessionState::Idle, 10, false, SessionActivity::Thinking, SessionSource::AgentDeck);

  SessionUpdate list[2] = {};
  list[0].id = "d2";
  list[0].state = SessionState::Working;
  list[1].id = "d3";
  list[1].state = SessionState::Idle;
  sessionTableReplaceSource(table, SessionSource::AgentDeck, list, 2, 50);

  TEST_ASSERT_EQUAL(-1, sessionTableFind(table, "d1"));
  TEST_ASSERT_TRUE(sessionTableFind(table, "d2") >= 0);
  TEST_ASSERT_TRUE(sessionTableFind(table, "d3") >= 0);
  TEST_ASSERT_TRUE(sessionTableFind(table, "r1") >= 0);
  TEST_ASSERT_EQUAL(2, sessionTableCountSource(table, SessionSource::AgentDeck));

  TEST_ASSERT_EQUAL(1, sessionTableClearSource(table, SessionSource::Rest));
  TEST_ASSERT_EQUAL(2, sessionTableCount(table));
}

void test_working_default_and_kept_activity() {
  const int a = put("a", SessionState::Working, 10);
  TEST_ASSERT_TRUE(table.slots[a].activity == SessionActivity::Thinking);
  put("a", SessionState::Working, 20, true, SessionActivity::Typing);
  put("a", SessionState::Working, 30);  // no activity -> keep typing
  TEST_ASSERT_TRUE(table.slots[a].activity == SessionActivity::Typing);
}

// ---- arbiter ----

void test_arbiter_empty_is_manual() {
  ArbiterDecision d = eval(1000, ArbiterTarget::Typing);
  TEST_ASSERT_FALSE(d.post);
}

void test_arbiter_priority() {
  put("w", SessionState::Working, 10, true, SessionActivity::Reading);
  TEST_ASSERT_TRUE(arbiterPickTarget(table) == ArbiterTarget::Reading);
  put("e", SessionState::Error, 20);
  TEST_ASSERT_TRUE(arbiterPickTarget(table) == ArbiterTarget::Error);
  put("q", SessionState::Waiting, 30);
  TEST_ASSERT_TRUE(arbiterPickTarget(table) == ArbiterTarget::Attention);
  put("q", SessionState::Ended, 40);
  put("e", SessionState::Idle, 50);
  TEST_ASSERT_TRUE(arbiterPickTarget(table) == ArbiterTarget::Reading);
  put("w", SessionState::Idle, 60);
  TEST_ASSERT_TRUE(arbiterPickTarget(table) == ArbiterTarget::Ring);
}

void test_arbiter_most_recent_working_wins() {
  put("a", SessionState::Working, 100, true, SessionActivity::Typing);
  put("b", SessionState::Working, 200, true, SessionActivity::Reading);
  TEST_ASSERT_TRUE(arbiterPickTarget(table) == ArbiterTarget::Reading);
  put("a", SessionState::Working, 300, true, SessionActivity::Thinking);
  TEST_ASSERT_TRUE(arbiterPickTarget(table) == ArbiterTarget::Thinking);
}

// Hub re-POSTs every live session unchanged every 60 s: keepalives must not
// change which working session is "most recent" (no activity flip-flop).
void test_arbiter_keepalive_does_not_reorder() {
  put("a", SessionState::Working, 1000, true, SessionActivity::Typing);
  put("b", SessionState::Working, 2000, true, SessionActivity::Reading);
  ArbiterDecision d = eval(2000);
  TEST_ASSERT_TRUE(d.post);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::Reading);

  // Keepalive of a (with and without activity) after b's last change.
  put("a", SessionState::Working, 61000, true, SessionActivity::Typing);
  TEST_ASSERT_TRUE(arbiterPickTarget(table) == ArbiterTarget::Reading);
  put("a", SessionState::Working, 62000);
  TEST_ASSERT_TRUE(arbiterPickTarget(table) == ArbiterTarget::Reading);
  d = eval(62000, ArbiterTarget::Reading);
  TEST_ASSERT_TRUE(d.post);  // only the 60 s refresh, same target
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::Reading);
  d = eval(63000, ArbiterTarget::Reading);
  TEST_ASSERT_FALSE(d.post);

  // Keepalive still refreshes last-seen for the reaper.
  const int a = sessionTableFind(table, "a");
  TEST_ASSERT_EQUAL_UINT32(62000, table.slots[a].seenMs);
  TEST_ASSERT_EQUAL_UINT32(1000, table.slots[a].changedMs);
}

void test_arbiter_posts_only_on_change() {
  put("a", SessionState::Working, 100, true, SessionActivity::Typing);
  ArbiterDecision d = eval(100);
  TEST_ASSERT_TRUE(d.post);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::Typing);
  d = eval(1100, ArbiterTarget::Typing);
  TEST_ASSERT_FALSE(d.post);
  put("a", SessionState::Working, 1500, true, SessionActivity::Reading);
  d = eval(1500, ArbiterTarget::Typing);
  TEST_ASSERT_TRUE(d.post);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::Reading);
}

void test_arbiter_refresh_every_60s() {
  put("a", SessionState::Working, 100, true, SessionActivity::Typing);
  TEST_ASSERT_TRUE(eval(100).post);
  TEST_ASSERT_FALSE(eval(100 + ARBITER_REFRESH_MS - 1, ArbiterTarget::Typing).post);
  ArbiterDecision d = eval(100 + ARBITER_REFRESH_MS, ArbiterTarget::Typing);
  TEST_ASSERT_TRUE(d.post);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::Typing);
  TEST_ASSERT_FALSE(eval(100 + ARBITER_REFRESH_MS + 1000, ArbiterTarget::Typing).post);
}

void test_arbiter_non_working_not_refreshed() {
  put("q", SessionState::Waiting, 100);
  ArbiterDecision d = eval(100);
  TEST_ASSERT_TRUE(d.post);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::Attention);
  // attention is one-shot; robot back to none must not re-trigger it.
  TEST_ASSERT_FALSE(eval(100 + 5 * ARBITER_REFRESH_MS, ArbiterTarget::None).post);
}

void test_arbiter_ring_once_per_transition() {
  put("a", SessionState::Working, 100, true, SessionActivity::Typing);
  eval(100);
  put("a", SessionState::Idle, 2000);
  ArbiterDecision d = eval(2000, ArbiterTarget::Typing);
  TEST_ASSERT_TRUE(d.post);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::Ring);
  // Next ticks: ring must not repeat nor be cut short by a `none` post.
  TEST_ASSERT_FALSE(eval(3000, ArbiterTarget::Ring).post);
  TEST_ASSERT_FALSE(eval(4000, ArbiterTarget::None).post);
  // Idle keepalive does not ring again.
  put("a", SessionState::Idle, 60000);
  TEST_ASSERT_FALSE(eval(60000).post);
  // A fresh working -> idle cycle rings again.
  put("a", SessionState::Working, 70000);
  TEST_ASSERT_TRUE(eval(70000).post);
  put("a", SessionState::Idle, 80000);
  d = eval(80000, ArbiterTarget::Thinking);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::Ring);
  TEST_ASSERT_TRUE(d.post);
}

void test_arbiter_ring_consumed_by_higher_priority() {
  put("a", SessionState::Working, 100, true, SessionActivity::Typing);
  put("b", SessionState::Working, 200, true, SessionActivity::Reading);
  eval(200);
  put("b", SessionState::Idle, 1000);
  ArbiterDecision d = eval(1000, ArbiterTarget::Reading);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::Typing);
  put("a", SessionState::Idle, 2000);
  d = eval(2000, ArbiterTarget::Typing);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::Ring);  // only a's transition
  TEST_ASSERT_FALSE(eval(3000).post);
}

void test_arbiter_manual_override_window() {
  put("a", SessionState::Working, 100, true, SessionActivity::Typing);
  eval(100);
  arbiterNoteManual(arb, 1000);  // user POST /anim name=ring
  put("a", SessionState::Working, 2000, true, SessionActivity::Reading);
  TEST_ASSERT_FALSE(eval(2000, ArbiterTarget::Ring).post);
  TEST_ASSERT_FALSE(eval(1000 + ARBITER_MANUAL_HOLD_MS - 1, ArbiterTarget::None).post);
  ArbiterDecision d = eval(1000 + ARBITER_MANUAL_HOLD_MS, ArbiterTarget::None);
  TEST_ASSERT_TRUE(d.post);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::Reading);
}

void test_arbiter_manual_window_swallows_ring() {
  put("a", SessionState::Working, 100);
  eval(100);
  arbiterNoteManual(arb, 1000);
  put("a", SessionState::Idle, 2000);
  TEST_ASSERT_FALSE(eval(2000, ArbiterTarget::Typing).post);
  ArbiterDecision d = eval(1000 + ARBITER_MANUAL_HOLD_MS, ArbiterTarget::Typing);
  TEST_ASSERT_TRUE(d.post);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::None);
}

void test_arbiter_release_when_table_empties() {
  put("a", SessionState::Working, 100);
  eval(100);
  put("a", SessionState::Ended, 500);
  ArbiterDecision d = eval(500, ArbiterTarget::Thinking);
  TEST_ASSERT_TRUE(d.post);
  TEST_ASSERT_TRUE(d.target == ArbiterTarget::None);
  TEST_ASSERT_FALSE(eval(1500, ArbiterTarget::Typing).post);  // manual mode now
}

// ---- LED bar ----

void test_led_colors() {
  Session s = {};
  TEST_ASSERT_EQUAL(0, sessionLedColor(s, 0).g);  // empty slot off
  const int i = put("a", SessionState::Idle, 100);
  LedRgb c = sessionLedColor(table.slots[i], 200);
  TEST_ASSERT_TRUE(c.r == 0 && c.g > 0 && c.g < 64 && c.b == 0);
  put("a", SessionState::Error, 300);
  c = sessionLedColor(table.slots[i], 300);
  TEST_ASSERT_TRUE(c.r > 0 && c.g == 0 && c.b == 0);
  put("a", SessionState::Working, 400);
  c = sessionLedColor(table.slots[i], 1000);
  TEST_ASSERT_TRUE(c.r == 0 && c.g == c.b && c.g > 0);
  put("a", SessionState::Waiting, 500);
  c = sessionLedColor(table.slots[i], 750);
  TEST_ASSERT_TRUE(c.r > c.g && c.b == 0);
  put("a", SessionState::Working, 600);
  put("a", SessionState::Idle, 1000);
  c = sessionLedColor(table.slots[i], 1000);
  TEST_ASSERT_EQUAL(255, c.g);  // finish flash
  c = sessionLedColor(table.slots[i], 1000 + LED_BAR_FINISH_FLASH_MS);
  TEST_ASSERT_TRUE(c.g > 0 && c.g < 64);  // back to dim idle
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_validate_id);
  RUN_TEST(test_validate_agent_label);
  RUN_TEST(test_parse_state_activity);
  RUN_TEST(test_sanitize);
  RUN_TEST(test_table_slots_stable_and_ended_removes);
  RUN_TEST(test_table_eviction_oldest_idle);
  RUN_TEST(test_table_eviction_no_idle_falls_back_to_least_recent);
  RUN_TEST(test_table_reap_30_min);
  RUN_TEST(test_table_clear_and_replace_source);
  RUN_TEST(test_working_default_and_kept_activity);
  RUN_TEST(test_arbiter_empty_is_manual);
  RUN_TEST(test_arbiter_priority);
  RUN_TEST(test_arbiter_most_recent_working_wins);
  RUN_TEST(test_arbiter_keepalive_does_not_reorder);
  RUN_TEST(test_arbiter_posts_only_on_change);
  RUN_TEST(test_arbiter_refresh_every_60s);
  RUN_TEST(test_arbiter_non_working_not_refreshed);
  RUN_TEST(test_arbiter_ring_once_per_transition);
  RUN_TEST(test_arbiter_ring_consumed_by_higher_priority);
  RUN_TEST(test_arbiter_manual_override_window);
  RUN_TEST(test_arbiter_manual_window_swallows_ring);
  RUN_TEST(test_arbiter_release_when_table_empties);
  RUN_TEST(test_led_colors);
  return UNITY_END();
}
