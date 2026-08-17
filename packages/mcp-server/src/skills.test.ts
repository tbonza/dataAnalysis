import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ALLOWED_FRONTMATTER_FIELDS,
  loadSkills,
  parseSkillFile,
  skillsDirectory,
} from "./skills.js";

/**
 * The skills are the portable half of this server, so they are held to the Agent
 * Skills specification (https://agentskills.io/specification) rather than to whatever
 * happens to load. The upstream skills these were adapted from would fail several of
 * these checks — non-spec frontmatter fields, mostly — which is the reason the checks
 * exist.
 */

const EXPECTED = ["chart-author", "chart-restyle", "data-analysis", "data-query", "report", "theme-author"];

const skills = loadSkills();

describe("skill inventory", () => {
  it("finds every skill the server means to serve", () => {
    assert.deepEqual(skills.map((s) => s.name).sort(), EXPECTED);
  });
});

describe("frontmatter compliance", () => {
  for (const skill of skills) {
    describe(skill.name, () => {
      it("uses only fields the specification permits", () => {
        const extra = Object.keys(skill.frontmatter).filter(
          (key) => !(ALLOWED_FRONTMATTER_FIELDS as readonly string[]).includes(key)
        );
        assert.deepEqual(
          extra,
          [],
          `unsupported frontmatter: ${extra.join(", ")} — the spec allows ${ALLOWED_FRONTMATTER_FIELDS.join(", ")}`
        );
      });

      it("has a spec-legal name matching its directory", () => {
        assert.equal(skill.name, skill.directory, "name must equal the parent directory name");
        assert.ok(skill.name.length >= 1 && skill.name.length <= 64, "name must be 1-64 characters");
        assert.match(skill.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase alphanumerics and single hyphens only");
        assert.ok(!skill.name.includes("--"), "no consecutive hyphens");
      });

      it("has a description that says what and when", () => {
        assert.ok(skill.description.length > 0, "description is required");
        assert.ok(
          skill.description.length <= 1024,
          `description is ${skill.description.length} chars, max 1024`
        );
        // The spec asks descriptions to carry both, which is what makes a skill
        // discoverable to an agent that has only seen its metadata.
        assert.match(skill.description, /\bUse (when|before|whenever)\b/i, "should state when to use it");
      });

      it("keeps optional fields within their constraints", () => {
        const compatibility = skill.frontmatter["compatibility"];
        if (compatibility !== undefined) {
          assert.equal(typeof compatibility, "string");
          assert.ok((compatibility as string).length <= 500);
        }
        const metadata = skill.frontmatter["metadata"];
        if (metadata !== undefined) {
          assert.ok(metadata && typeof metadata === "object" && !Array.isArray(metadata));
          for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
            assert.equal(typeof value, "string", `metadata.${key} must be a string`);
          }
        }
        const allowedTools = skill.frontmatter["allowed-tools"];
        if (allowedTools !== undefined) {
          // The spec's shape is a space-separated string, not the YAML list that
          // data-formulator's own skills use.
          assert.equal(typeof allowedTools, "string", "allowed-tools must be a space-separated string");
        }
      });
    });
  }
});

describe("progressive disclosure", () => {
  for (const skill of skills) {
    it(`${skill.name} keeps SKILL.md under 500 lines`, () => {
      const lines = skill.text.split("\n").length;
      assert.ok(lines < 500, `${lines} lines — move detail into references/`);
    });

    it(`${skill.name} resolves every relative link it makes`, () => {
      const dir = join(skillsDirectory, skill.directory);
      const links = [...skill.body.matchAll(/\]\((?!https?:|chart:|mailto:)([^)#]+)\)/g)].map(
        (m) => m[1]!
      );
      for (const link of links) {
        assert.ok(existsSync(join(dir, link)), `broken relative link: ${link}`);
      }
    });

    for (const reference of skill.references) {
      it(`${skill.name}/${reference.relativePath} is non-empty`, () => {
        assert.ok(reference.text.trim().length > 0);
      });
    }
  }
});

describe("parseSkillFile", () => {
  it("rejects a file with no frontmatter", () => {
    assert.throws(() => parseSkillFile("# Just a heading\n"), /must begin with/);
  });

  it("rejects frontmatter that is not a mapping", () => {
    assert.throws(() => parseSkillFile("---\n- a\n- b\n---\nbody\n"), /must be a YAML mapping/);
  });

  it("separates frontmatter from body", () => {
    const { frontmatter, body } = parseSkillFile("---\nname: x\ndescription: y\n---\n# Body\n");
    assert.deepEqual(frontmatter, { name: "x", description: "y" });
    assert.match(body, /# Body/);
  });
});

describe("skill content", () => {
  it("data-query states what it cannot do, so agents do not plan around absent features", () => {
    const skill = skills.find((s) => s.name === "data-query");
    assert.ok(skill);
    assert.match(skill.body, /cannot do/i);
    for (const absent of ["cluster", "forecast", "join"]) {
      assert.match(skill.body.toLowerCase(), new RegExp(absent), `should mention ${absent}`);
    }
  });

  it("every skill referenced by another exists", () => {
    const names = new Set(skills.map((s) => s.name));
    for (const skill of skills) {
      for (const match of skill.body.matchAll(/\*\*([a-z][a-z-]+)\*\* skill|the \*\*([a-z][a-z-]+)\*\*/g)) {
        const candidate = match[1] ?? match[2];
        if (candidate && candidate.includes("-") && !names.has(candidate)) {
          assert.fail(`${skill.name} refers to a skill that does not exist: ${candidate}`);
        }
      }
    }
  });

  it("ships the skills directory with the package", () => {
    // A `files` list that omits skills/ would publish a server with no skills, which
    // is the one failure mode that would silently gut the product.
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { files?: string[] };
    if (manifest.files) {
      assert.ok(
        manifest.files.some((entry) => entry.replace(/\/$/, "") === "skills"),
        "package.json `files` must include skills/"
      );
    }
  });
});
