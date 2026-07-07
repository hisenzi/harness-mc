import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const registryPath = path.join(root, "system-workflow", "registries", "morrowise-product-promotions.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

const DECISIONS = new Set(["product_candidate", "not_product", "deferred"]);
const FORBIDDEN_SOURCE_PATTERNS = [
  /\/Users\/somedesign/,
  /secrets?\//i,
  /token/i,
  /cookie/i,
  /runtime auth/i,
  /browser cookies/i,
];

assert.equal(registry.registry_id, "morrowise-product-promotions.v0");
assert.equal(registry.task_id, "morrowise-product-promotion-gate");
assert.equal(registry.source_of_truth, "$COLLAB/harness-mc/system-workflow/registries/morrowise-product-promotions.json");
assert.equal(registry.verifier_ref, "npm run test:morrowise-product-promotions");
assert.deepEqual(registry.decision_vocabulary, [...DECISIONS]);
assert.ok(registry.customer_instance_policy, "customer_instance_policy is required");
assert.equal(registry.customer_instance_policy.default_local_data_root.startsWith("$HOME/"), true);
assert.ok(registry.customer_instance_policy.forbidden_locations.includes("$COLLAB"));
assert.match(registry.customer_instance_policy.git_policy, /must not be committed/i);

for (const field of [
  "id",
  "source_capability",
  "source_task_anchor",
  "maturity_evidence",
  "customer_problem",
  "target_customer",
  "payable_problem",
  "repeatable_delivery",
  "support_cost",
  "pricing_sku_hypothesis",
  "product_decision",
  "product_line_target",
  "customer_instance_boundary",
  "installer_permission_model",
  "data_ownership",
  "verifiers",
  "release_support_needs",
  "promotion_risks",
  "last_reviewed_at",
]) {
  assert.ok(registry.required_record_fields.includes(field), `required_record_fields must include ${field}`);
}

assert.ok(Array.isArray(registry.records), "records must be an array");

const seen = new Set();
for (const record of registry.records) {
  for (const field of registry.required_record_fields) {
    assert.ok(Object.hasOwn(record, field), `record ${record.id || "(missing id)"} missing ${field}`);
  }

  assert.equal(seen.has(record.id), false, `duplicate promotion record id: ${record.id}`);
  seen.add(record.id);

  assert.ok(DECISIONS.has(record.product_decision), `invalid product_decision for ${record.id}`);
  assert.match(record.source_task_anchor, /^\$COLLAB\/harness-mc\/milestones\//, `${record.id} source_task_anchor must be a $COLLAB task anchor`);

  assert.ok(Array.isArray(record.maturity_evidence), `${record.id} maturity_evidence must be an array`);
  assert.ok(Array.isArray(record.verifiers), `${record.id} verifiers must be an array`);
  assert.ok(record.verifiers.length > 0 || record.product_decision !== "product_candidate", `${record.id} product_candidate needs verifiers`);

  for (const key of ["customer_instance_boundary", "installer_permission_model", "data_ownership"]) {
    assert.equal(typeof record[key], "object", `${record.id} ${key} must be an object`);
  }

  const serialized = JSON.stringify(record);
  for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
    assert.equal(pattern.test(serialized), false, `${record.id} contains forbidden source/auth pattern: ${pattern}`);
  }
}

console.log("MorroWise product promotions verification OK");
