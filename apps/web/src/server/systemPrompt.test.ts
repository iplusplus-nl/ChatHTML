import assert from "node:assert/strict";
import test from "node:test";
import { SYSTEM_PROMPT, buildUiComplexityPrompt } from "./systemPrompt.js";

test("discourages back navigation actions in chat artifacts", () => {
  assert.match(SYSTEM_PROMPT, /conversation history is already the navigation/i);
  assert.match(SYSTEM_PROMPT, /返回选择方向/);
  assert.match(SYSTEM_PROMPT, /返回低因列表/);
  assert.match(SYSTEM_PROMPT, /continue forward/i);
});

test("pushes generated artifacts through visual layout quality checks", () => {
  assert.match(SYSTEM_PROMPT, /Honor requested quantity/i);
  assert.match(SYSTEM_PROMPT, /IDs must be unique/i);
  assert.match(SYSTEM_PROMPT, /styled empty placeholder/i);
  assert.match(SYSTEM_PROMPT, /horizontal overflow/i);
  assert.match(SYSTEM_PROMPT, /no accidental duplicate primary subjects/i);
});

test("sets comfortable legibility floors without forcing a high-contrast palette", () => {
  assert.match(SYSTEM_PROMPT, /4\.5:1 for normal text/i);
  assert.match(SYSTEM_PROMPT, /3:1 for large text/i);
  assert.match(SYSTEM_PROMPT, /essential UI[\s\S]*meaning-bearing graphics/i);
  assert.match(
    SYSTEM_PROMPT,
    /actual immediate rendered background[\s\S]*opacity[\s\S]*gradients/i
  );
  assert.match(SYSTEM_PROMPT, /Preserve the requested hues[\s\S]*art direction/i);
  assert.match(SYSTEM_PROMPT, /not a request for maximum contrast or a high-contrast mode/i);
  assert.match(SYSTEM_PROMPT, /pure black on white or white on black/i);
  assert.match(SYSTEM_PROMPT, /only when they are genuinely nonessential/i);
  assert.match(SYSTEM_PROMPT, /Muted styling is not an exemption/i);
  assert.match(SYSTEM_PROMPT, /data-streamui-decorative/i);
  assert.match(SYSTEM_PROMPT, /Never use those markers to silence/i);
});

test("instructs formula output to use MathJax delimiters", () => {
  assert.match(SYSTEM_PROMPT, /MathJax/i);
  assert.match(SYSTEM_PROMPT, /\\\(/);
  assert.match(SYSTEM_PROMPT, /\\\[/);
  assert.match(SYSTEM_PROMPT, /TeX/i);
});

test("forbids inline handlers that the artifact sanitizer removes", () => {
  assert.match(SYSTEM_PROMPT, /Never use inline event-handler attributes/i);
  assert.match(SYSTEM_PROMPT, /Always bind[\s\S]*addEventListener/i);
});

test("builds one level-specific UI complexity instruction per turn", () => {
  const cases = [
    { value: 10, label: "Minimal" },
    { value: 30, label: "Simple" },
    { value: 50, label: "Balanced" },
    { value: 75, label: "Rich" },
    { value: 90, label: "Elaborate" }
  ];
  const prompts = cases.map(({ value, label }) => {
    const prompt = buildUiComplexityPrompt(value);

    assert.match(prompt, new RegExp(`UI complexity: ${label}`));
    assert.match(prompt, /latest setting overrides/i);
    assert.doesNotMatch(prompt, /\d/);
    return prompt;
  });

  assert.equal(new Set(prompts).size, cases.length);
});
