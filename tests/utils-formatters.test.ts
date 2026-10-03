import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatDuration, formatCompactNumber, formatPercent } from "@/lib/utils/formatters";

describe("utils/formatters", () => {
  it("formatBytes formats data sizes correctly", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(-10), "0 B");
    assert.equal(formatBytes(500), "500 B");
    assert.equal(formatBytes(1024), "1 KB");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(1048576), "1 MB");
    assert.equal(formatBytes(1073741824), "1 GB");
  });

  it("formatDuration formats seconds to MM:SS and HH:MM:SS", () => {
    assert.equal(formatDuration(0), "0:00");
    assert.equal(formatDuration(-5), "0:00");
    assert.equal(formatDuration(45), "0:45");
    assert.equal(formatDuration(65), "1:05");
    assert.equal(formatDuration(3600), "1:00:00");
    assert.equal(formatDuration(3665), "1:01:05");
  });

  it("formatCompactNumber formats numbers into compact notation", () => {
    assert.equal(formatCompactNumber(0), "0");
    assert.equal(formatCompactNumber(999), "999");
    assert.match(formatCompactNumber(1500), /^1\.?5?K$/);
    assert.match(formatCompactNumber(1000000), /^1M$/);
  });

  it("formatPercent formats decimals and percentages correctly", () => {
    assert.equal(formatPercent(0.5), "50%");
    assert.equal(formatPercent(1), "100%");
    assert.equal(formatPercent(0.125, 1), "12.5%");
    assert.equal(formatPercent(75), "75%");
  });
});
