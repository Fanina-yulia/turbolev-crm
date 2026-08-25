import assert from "node:assert/strict";
import { getCompletionFromMechanicView } from "@/src/services/diagnostic-completion-view.service";

const completion = await getCompletionFromMechanicView([{
  sections: [{
    code: "EXHAUST",
    items: Array.from({ length: 22 }, (_, index) => ({
      id: null,
      templateItemId: `phantom_${index}`,
      state: "NOT_CHECKED",
    })),
  }],
}]);

assert.deepEqual(completion, {
  canSubmit: false,
  total: 0,
  checked: 0,
  requiredTotal: 0,
  requiredChecked: 0,
  requiredRemaining: 0,
  optionalTotal: 0,
  optionalRemaining: 0,
  autoFillRemaining: 0,
});

console.log("Diagnostic completion view smoke: PASS");
