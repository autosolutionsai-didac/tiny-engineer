#include "sessions/arbiter.h"

namespace {

ArbiterTarget activityTarget(SessionActivity activity) {
  switch (activity) {
    case SessionActivity::Typing:
      return ArbiterTarget::Typing;
    case SessionActivity::Reading:
      return ArbiterTarget::Reading;
    case SessionActivity::Thinking:
    default:
      return ArbiterTarget::Thinking;
  }
}

void consumeFinished(SessionTable& table) {
  for (size_t i = 0; i < SESSION_MAX; i++) {
    table.slots[i].finished = false;
  }
}

}  // namespace

void arbiterInit(ArbiterState& state) {
  state.lastTarget = ArbiterTarget::None;
  state.lastPostMs = 0;
  state.manualActive = false;
  state.manualStartMs = 0;
  state.resync = false;
}

void arbiterNoteManual(ArbiterState& state, uint32_t nowMs) {
  state.manualActive = true;
  state.manualStartMs = nowMs;
}

bool arbiterManualActive(const ArbiterState& state, uint32_t nowMs) {
  return state.manualActive &&
         (nowMs - state.manualStartMs) < ARBITER_MANUAL_HOLD_MS;
}

bool arbiterTargetIsWorking(ArbiterTarget target) {
  return target == ArbiterTarget::Typing ||
         target == ArbiterTarget::Reading ||
         target == ArbiterTarget::Thinking;
}

const char* arbiterTargetName(ArbiterTarget target) {
  switch (target) {
    case ArbiterTarget::Attention:
      return "attention";
    case ArbiterTarget::Error:
      return "error";
    case ArbiterTarget::Typing:
      return "typing";
    case ArbiterTarget::Reading:
      return "reading";
    case ArbiterTarget::Thinking:
      return "thinking";
    case ArbiterTarget::Ring:
      return "ring";
    case ArbiterTarget::Other:
      return "other";
    case ArbiterTarget::None:
    default:
      return "none";
  }
}

ArbiterTarget arbiterPickTarget(const SessionTable& table) {
  bool anyWaiting = false;
  bool anyError = false;
  bool anyFinished = false;
  int newestWorking = -1;

  for (size_t i = 0; i < SESSION_MAX; i++) {
    const Session& s = table.slots[i];

    if (!s.used) {
      continue;
    }

    switch (s.state) {
      case SessionState::Waiting:
        anyWaiting = true;
        break;
      case SessionState::Error:
        anyError = true;
        break;
      case SessionState::Working:
        // Ties (same ms) go to the later slot; any stable rule is fine.
        if (newestWorking < 0 ||
            static_cast<int32_t>(
              s.changedMs - table.slots[newestWorking].changedMs
            ) >= 0) {
          newestWorking = static_cast<int>(i);
        }
        break;
      case SessionState::Idle:
        if (s.finished) {
          anyFinished = true;
        }
        break;
      case SessionState::Ended:
      default:
        break;
    }
  }

  if (anyWaiting) {
    return ArbiterTarget::Attention;
  }

  if (anyError) {
    return ArbiterTarget::Error;
  }

  if (newestWorking >= 0) {
    return activityTarget(table.slots[newestWorking].activity);
  }

  if (anyFinished) {
    return ArbiterTarget::Ring;
  }

  return ArbiterTarget::None;
}

ArbiterDecision arbiterEvaluate(
  ArbiterState& state,
  SessionTable& table,
  ArbiterTarget current,
  uint32_t nowMs
) {
  ArbiterDecision decision{false, ArbiterTarget::None};

  if (state.manualActive) {
    if (arbiterManualActive(state, nowMs)) {
      // Transitions during the manual hold do not ring later.
      consumeFinished(table);
      return decision;
    }

    state.manualActive = false;
    state.resync = true;
  }

  if (sessionTableCount(table) == 0) {
    state.resync = false;

    // Last session vanished while we were driving the robot: release once.
    if (state.lastTarget != ArbiterTarget::None) {
      state.lastTarget = ArbiterTarget::None;
      state.lastPostMs = nowMs;
      decision.post =
        current != ArbiterTarget::None && current != ArbiterTarget::Other;
      decision.target = ArbiterTarget::None;
    }

    return decision;
  }

  const ArbiterTarget target = arbiterPickTarget(table);
  consumeFinished(table);
  decision.target = target;

  if (state.resync) {
    state.resync = false;
    decision.post = target != current || arbiterTargetIsWorking(target);
  } else if (target != state.lastTarget) {
    decision.post = true;
  } else if (arbiterTargetIsWorking(target) &&
             (nowMs - state.lastPostMs) >= ARBITER_REFRESH_MS) {
    decision.post = true;
  }

  if (decision.post) {
    state.lastPostMs = nowMs;
  }

  // Ring is one-shot: the controller returns to none on its own, so record
  // none to avoid cutting the ring short on the next tick.
  state.lastTarget = target == ArbiterTarget::Ring ? ArbiterTarget::None : target;
  return decision;
}
