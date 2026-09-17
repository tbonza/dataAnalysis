import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { convertCsvDirectory } from "./csvToParquet.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function parquetRowCount(path: string): Promise<number> {
  const instance = await DuckDBInstance.create(":memory:");
  try {
    const conn = await instance.connect();
    try {
      const reader = await conn.runAndReadAll(
        `SELECT count(*) AS n FROM read_parquet('${path.replace(/'/g, "''")}')`
      );
      return Number(reader.getRowObjectsJS()[0]?.["n"] ?? 0);
    } finally {
      conn.disconnectSync();
    }
  } finally {
    instance.closeSync();
  }
}

describe("convertCsvDirectory", () => {
  it("converts every real CSV, slugifies its name, and skips macOS junk files", async () => {
    const inputDir = tempDir("csv-to-parquet-in-");
    const outputDir = tempDir("csv-to-parquet-out-");
    try {
      writeFileSync(join(inputDir, "Sample_Data.csv"), "id,name,amount\n1,Alice,10.5\n2,Bob,20\n");
      writeFileSync(join(inputDir, "._Sample_Data.csv"), "not a real csv");
      writeFileSync(join(inputDir, "notes.txt"), "ignore me");

      const { converted, failed } = await convertCsvDirectory(inputDir, outputDir);

      assert.deepEqual(failed, []);
      assert.equal(converted.length, 1);
      assert.equal(converted[0]?.name, "sample-data");
      assert.ok(existsSync(converted[0]!.parquetPath));
      assert.equal(await parquetRowCount(converted[0]!.parquetPath), 2);
    } finally {
      rmSync(inputDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("refuses two files that slugify to the same name", async () => {
    const inputDir = tempDir("csv-to-parquet-collide-");
    const outputDir = tempDir("csv-to-parquet-collide-out-");
    try {
      writeFileSync(join(inputDir, "My Data.csv"), "a\n1\n");
      writeFileSync(join(inputDir, "My_Data.csv"), "a\n2\n");

      await assert.rejects(() => convertCsvDirectory(inputDir, outputDir), /both slugify to/);
    } finally {
      rmSync(inputDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("refuses an input directory with no CSV files", async () => {
    const inputDir = tempDir("csv-to-parquet-empty-");
    const outputDir = tempDir("csv-to-parquet-empty-out-");
    try {
      await assert.rejects(() => convertCsvDirectory(inputDir, outputDir), /No \.csv files/);
    } finally {
      rmSync(inputDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
