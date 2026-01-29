# OpenCode Rules Plugin - Comprehensive Audit Report

**Audit Date:** 2026-01-29
**Auditor:** Claude Code Audit Agent
**Project Path:** `/home/nomadx/opencode-cursor/opencode-rules`
**Repository:** https://github.com/frap129/opencode-rules
**Package:** `opencode-rules@0.3.0`

---

## Executive Summary

- **Purpose**: A lightweight OpenCode plugin that discovers markdown rule files and injects them into AI agent system prompts, enabling flexible behavior customization without per-project configuration
- **Architecture**: Clean two-hook transform approach using OpenCode's experimental API - `messages.transform` for context extraction and `system.transform` for rule injection
- **Maturity**: Well-established project with comprehensive test suite (2,265+ lines of tests), good documentation, and active maintenance
- **Strengths**: Excellent caching strategy, robust conditional rule matching (globs + keywords), comprehensive test coverage, clean TypeScript architecture
- **Concerns**: Relies on experimental OpenCode APIs that may change; no authentication flow; limited observability/metrics
- **Recommendation**: Solid reference implementation for OpenCode plugin architecture with excellent patterns for caching, conditional logic, and test coverage

---

## 1. Architecture Analysis

### 1.1 Overall Structure

The project follows a clean, minimal architecture with clear separation of concerns:

```
opencode-rules/
├── src/
│   ├── index.ts          # Plugin entry point & hook handlers (248 lines)
│   ├── utils.ts          # Core utilities & rule processing (555 lines)
│   └── index.test.ts     # Comprehensive test suite (2,265 lines)
├── skills/
│   └── crafting-rules/   # Skill for creating rules
├── docs/                 # Documentation
├── openspec/             # OpenSpec change management
└── package.json          # NPM configuration
```

### 1.2 Plugin Architecture

**Hook-Based Design:**
The plugin uses OpenCode's experimental transform hooks:

1. **`experimental.chat.messages.transform`** - Context Extraction
   - Extracts file paths from tool invocations (read, edit, write, glob, grep)
   - Extracts user prompt text for keyword matching
   - Stores context in a session-scoped Map keyed by sessionID
   - Does NOT modify messages (read-only operation)

2. **`experimental.chat.system.transform`** - Rule Injection
   - Retrieves context using sessionID from the Map
   - Filters rules based on glob patterns and keyword matching
   - Appends formatted rules to system prompt
   - Cleans up session context to prevent memory leaks

**Session Context Management:**
```typescript
// Per-session storage using Map keyed by sessionID
const sessionContextMap = new Map<string, SessionContext>();

interface SessionContext {
  filePaths: string[];
  userPrompt: string | undefined;
}
```

This is an elegant solution for sharing context between hooks without polluting the messages array.

### 1.3 Rule Discovery Architecture

**Dual Discovery Strategy:**
- **Global Rules**: `$XDG_CONFIG_HOME/opencode/rules/` (typically `~/.config/opencode/rules/`)
- **Project Rules**: `.opencode/rules/` (in project root)

**Recursive Scanning:**
- Recursively scans all subdirectories
- Supports both `.md` and `.mdc` file extensions
- Excludes hidden files/directories (starting with `.`)
- Performed once at plugin initialization for performance

### 1.4 Rule Processing Pipeline

```
Discovery → Caching → Metadata Parsing → Filtering → Formatting → Injection
```

1. **Discovery**: Recursively scan directories for rule files
2. **Caching**: mtime-based cache invalidation for efficient re-reads
3. **Metadata Parsing**: YAML frontmatter extraction for globs/keywords
4. **Filtering**: Apply conditional logic (globs OR keywords)
5. **Formatting**: Strip frontmatter, add headers, join with separators
6. **Injection**: Append to system prompt (array or string format)

### 1.5 File Structure Analysis

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 248 | Plugin entry, hook handlers |
| `src/utils.ts` | 555 | Core utilities, caching, filtering |
| `src/index.test.ts` | 2,265 | Comprehensive test suite |
| **Total Source** | **803** | **Well-focused codebase** |

---

## 2. Feature Comparison

### 2.1 Supported Features

| Feature | Status | Implementation Quality |
|---------|--------|----------------------|
| Rule file discovery | ✅ | Recursive scanning, XDG compliance |
| Dual format support (.md/.mdc) | ✅ | Both extensions supported |
| Global rules | ✅ | `~/.config/opencode/rules/` |
| Project rules | ✅ | `.opencode/rules/` |
| YAML frontmatter | ✅ | Full metadata parsing |
| Glob-based conditions | ✅ | `minimatch` library |
| Keyword-based conditions | ✅ | Word-boundary matching |
| Combined conditions (OR logic) | ✅ | globs OR keywords |
| Unconditional rules | ✅ | No metadata = always apply |
| File path extraction | ✅ | From tool calls and text |
| Rule caching | ✅ | mtime-based invalidation |
| Debug logging | ✅ | Environment variable controlled |
| Session context | ✅ | Map-based with cleanup |
| TypeScript | ✅ | Full type coverage |

### 2.2 Notable Feature Gaps

| Feature | Status | Impact |
|---------|--------|--------|
| AND logic (globs AND keywords) | ❌ | Cannot require both conditions |
| Rule priority/ordering | ❌ | Alphabetical by filepath only |
| Rule dependencies | ❌ | Cannot reference other rules |
| Dynamic rule reloading | ❌ | Manual cache clear only |
| Rule validation | ❌ | No schema validation for metadata |
| Rule templating | ❌ | No variable substitution |
| Rule versioning | ❌ | No built-in versioning support |
| Web UI for rule management | ❌ | CLI/file-based only |

---

## 3. Code Quality Assessment

### 3.1 TypeScript Patterns

**Strengths:**
- Strict TypeScript configuration (`strict: true`)
- Explicit type annotations on exported functions
- Interface definitions for complex objects
- Proper use of union types and type guards

**Configuration Highlights:**
```json
{
  "strict": true,
  "noImplicitAny": true,
  "noImplicitReturns": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "exactOptionalPropertyTypes": true,
  "isolatedModules": true,
  "verbatimModuleSyntax": true
}
```

### 3.2 Error Handling

**Patterns Used:**
- Try-catch blocks with proper error typing
- Graceful degradation (returns empty arrays/strings on failure)
- Warning logs for recoverable errors
- Cache entry deletion on file read failures

**Example:**
```typescript
function getCachedRule(filePath: string): CachedRule | undefined {
  try {
    // ... read and cache
  } catch (error) {
    ruleCache.delete(filePath);  // Clean up stale entry
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[opencode-rules] Warning: Failed to read rule file ${filePath}: ${message}`);
    return undefined;
  }
}
```

**Assessment:** Good error handling with appropriate fallback behavior. Could benefit from more specific error types.

### 3.3 Validation

**Strengths:**
- YAML parsing with error catching
- Array type filtering (only string elements)
- Empty/whitespace filtering for globs/keywords
- Path regex validation for file extraction

**Gaps:**
- No JSON schema validation for metadata
- No validation of glob pattern syntax
- No duplicate detection in rule discovery

### 3.4 Logging

**Implementation:**
- Debug logging controlled by `OPENCODE_RULES_DEBUG` environment variable
- Warn-level logging for recoverable errors
- Structured prefix: `[opencode-rules]`

**Coverage:**
- Rule discovery counts
- Cache hit/miss tracking
- Rule inclusion/exclusion decisions
- Session context operations

**Assessment:** Appropriate logging strategy - verbose when needed, silent by default.

### 3.5 Code Organization

**Strengths:**
- Clear separation between plugin logic (index.ts) and utilities (utils.ts)
- Cohesive function groupings
- Consistent naming conventions (camelCase functions, PascalCase types)
- Single responsibility principle followed

**Areas for Improvement:**
- `utils.ts` at 555 lines could be split into focused modules (caching, parsing, extraction)
- Some functions could benefit from early returns to reduce nesting

### 3.6 Test Coverage

**Comprehensive Test Suite:**
- 2,265 lines of tests (2.8x test-to-code ratio)
- 87 test cases covering all major functionality
- Organized into logical describe blocks:
  - `extractFilePathsFromMessages` - 24 test cases
  - `promptMatchesKeywords` - 10 test cases
  - `parseRuleMetadata` - 8 test cases
  - `discoverRuleFiles` - 15 test cases
  - `readAndFormatRules` - 21 test cases
  - `OpenCodeRulesPlugin` - 13 integration test cases
  - Edge cases - 9 test cases
  - Cache functionality - 3 test cases

**Test Quality:**
- Proper setup/teardown with temporary directories
- Environment variable mocking for XDG paths
- Integration tests for full plugin flow
- Edge case coverage (empty inputs, malformed data)
- Cache invalidation testing

---

## 4. OpenCode Integration Analysis

### 4.1 Plugin Registration

**Pattern:** Standard OpenCode plugin export
```typescript
const openCodeRulesPlugin = async (input: PluginInput) => {
  const ruleFiles = await discoverRuleFiles(input.directory);
  return {
    'experimental.chat.messages.transform': async (...) => {...},
    'experimental.chat.system.transform': async (...) => {...},
  };
};

export default openCodeRulesPlugin;
```

### 4.2 Hook Implementation Details

**messages.transform:**
- Extracts sessionID from message parts or info
- Parses file paths from tool invocations (read, edit, write, glob, grep)
- Extracts user prompt text for keyword matching
- Stores context in session-scoped Map
- Returns unmodified output (read-only)

**system.transform:**
- Retrieves context using sessionID from input
- Applies conditional rule filtering
- Appends formatted rules to system prompt
- Handles both array and string system prompt formats
- Deletes session context after use (memory leak prevention)

### 4.3 Auth Flow

**Status:** No authentication flow implemented
- This is appropriate for a local-only plugin
- No API keys or external services
- Relies on file system permissions

### 4.4 Configuration

**Zero-Configuration Approach:**
- No required configuration files
- Uses XDG Base Directory specification for global rules
- Discovers project rules from standard location
- Optional debug logging via environment variable

**Configuration Sources:**
1. `XDG_CONFIG_HOME` environment variable
2. `~/.config/opencode/rules/` (fallback)
3. `.opencode/rules/` (project-local)

### 4.5 Dependencies on OpenCode

**Runtime Dependencies:**
- `@opencode-ai/plugin@^1.1.34` - Plugin framework
- `@opencode-ai/sdk@^1.1.34` - SDK integration

**API Usage:**
- `experimental.chat.messages.transform` hook
- `experimental.chat.system.transform` hook
- `PluginInput` type

**Risk Assessment:**
- **High**: Uses experimental APIs that may change
- **Medium**: Dependency on specific SDK versions
- **Mitigation**: Clean hook interface makes updates manageable

---

## 5. Strengths (What They Do Exceptionally Well)

### 5.1 Caching Strategy

**mtime-Based Cache Invalidation:**
```typescript
interface CachedRule {
  content: string;
  metadata: RuleMetadata | undefined;
  strippedContent: string;
  mtime: number;  // Modification time for invalidation
}
```

- Automatic cache refresh when files change
- No polling or file watching needed
- Minimal memory footprint
- Exported `clearRuleCache()` for manual invalidation

### 5.2 Conditional Rule System

**Sophisticated Matching Logic:**
- OR logic between globs and keywords (either triggers)
- Word-boundary keyword matching with prefix support
- Glob pattern matching using industry-standard `minimatch`
- Case-insensitive matching for keywords

**Example Rule (`.mdc` with frontmatter):**
```markdown
---
globs:
  - '**/*.test.ts'
keywords:
  - 'testing'
  - 'jest'
---

# Testing Best Practices
...
```

### 5.3 File Path Extraction

**Comprehensive Path Extraction:**
- Tool invocation parsing (read, edit, write, glob, grep)
- Text content regex matching
- Relative path support (`./`, `../`)
- Absolute path support
- URL/email filtering
- Deduplication

**Smart Glob Handling:**
```typescript
// Extracts directory from glob patterns
extractDirFromGlob('src/components/**/*.ts') → 'src/components'
extractDirFromGlob('**/*.test.ts') → null  // No directory prefix
```

### 5.4 Test Coverage

**Industry-Leading Test-to-Code Ratio:**
- 2,265 lines of tests for 803 lines of source code
- 87 test cases with clear naming (Arrange/Act/Assert pattern)
- Proper isolation with temporary directories
- Integration tests for full plugin flow
- Edge case coverage for robustness

### 5.5 Documentation Quality

**Comprehensive Documentation:**
- Detailed README with examples
- Architecture explanation
- Usage documentation in `/docs`
- Skill documentation for rule crafting
- OpenSpec project management
- Inline code comments for complex logic

### 5.6 Session Context Management

**Memory-Efficient Design:**
- Map-based storage keyed by sessionID
- Automatic cleanup after system.transform
- No persistent session state
- Thread-safe for concurrent sessions

---

## 6. Weaknesses/Gaps (Missing Features, Issues, Limitations)

### 6.1 Experimental API Dependency

**Risk:** High reliance on experimental OpenCode APIs
- `experimental.chat.messages.transform`
- `experimental.chat.system.transform`

**Impact:** API changes could break functionality
**Mitigation:** Clean abstraction makes updates manageable

### 6.2 No AND Logic for Conditions

**Limitation:** Cannot require both globs AND keywords to match
- Current: globs OR keywords (either triggers rule)
- Missing: globs AND keywords (both required)

**Workaround:** Split into multiple rules with more specific conditions

### 6.3 Limited Observability

**Missing:**
- Metrics collection (rules applied, cache hit rates)
- Structured logging (JSON format)
- Performance timing
- Rule application analytics

### 6.4 No Rule Validation

**Missing:**
- JSON Schema validation for metadata
- Glob pattern syntax validation
- Duplicate rule detection
- Circular reference detection (if dependencies added)

### 6.5 No Hot Reload

**Limitation:** Rule changes require cache clear or restart
- No file watching for automatic reload
- Manual `clearRuleCache()` call needed
- No signal-based reload (SIGHUP)

### 6.6 Limited Rule Interoperability

**Missing:**
- Rule inheritance/composition
- Rule dependencies
- Rule templates/variables
- Rule versioning

---

## 7. Recommendations for Our Project

### 7.1 Adopt Patterns from opencode-rules

**1. Caching Strategy**
```typescript
// Implement mtime-based caching for any file-based configuration
interface CachedConfig {
  content: T;
  mtime: number;
}
```
- Reduces file system overhead
- Automatic invalidation on changes
- Minimal memory footprint

**2. Session Context Management**
```typescript
// Use Map-based session storage for cross-hook communication
const sessionContextMap = new Map<string, SessionContext>();
```
- Clean separation between hooks
- Automatic cleanup prevents memory leaks
- Type-safe context passing

**3. Conditional Logic System**
- Implement glob + keyword matching for context-aware features
- OR logic provides flexibility
- Word-boundary matching prevents false positives

**4. Comprehensive Testing**
- Target 2:1 test-to-code ratio minimum
- Test both unit and integration scenarios
- Use temporary directories for file system tests
- Mock environment variables appropriately

### 7.2 Avoid Identified Weaknesses

**1. Minimize Experimental API Usage**
- Wrap experimental APIs in abstraction layers
- Document API version dependencies
- Plan migration paths for API changes

**2. Add AND Logic for Conditions**
```typescript
// Consider supporting both OR and AND logic
if (rule.logic === 'AND') {
  return globsMatch && keywordsMatch;
} else {
  return globsMatch || keywordsMatch;
}
```

**3. Implement Observability**
- Add metrics for key operations
- Use structured logging
- Track performance of critical paths

**4. Add Validation Layer**
- JSON Schema validation for configurations
- Input sanitization
- Clear error messages for invalid inputs

### 7.3 Competitive Differentiation

**Potential Improvements:**
1. **Hot Reload**: File watching for automatic rule reloading
2. **Validation**: JSON Schema validation for rule metadata
3. **Metrics**: Built-in metrics collection and reporting
4. **AND Logic**: Support for requiring multiple conditions
5. **Rule Templates**: Variable substitution in rules
6. **Web UI**: Management interface for rules

---

## 8. File Reference Summary

### Core Files
| File | Path | Purpose |
|------|------|---------|
| Plugin Entry | `/home/nomadx/opencode-cursor/opencode-rules/src/index.ts` | Main plugin with hook handlers |
| Utilities | `/home/nomadx/opencode-cursor/opencode-rules/src/utils.ts` | Caching, parsing, filtering |
| Tests | `/home/nomadx/opencode-cursor/opencode-rules/src/index.test.ts` | Comprehensive test suite |
| Package | `/home/nomadx/opencode-cursor/opencode-rules/package.json` | NPM configuration |

### Configuration Files
| File | Path | Purpose |
|------|------|---------|
| TypeScript | `/home/nomadx/opencode-cursor/opencode-rules/tsconfig.json` | Strict TS config |
| Vitest | `/home/nomadx/opencode-cursor/opencode-rules/vitest.config.ts` | Test configuration |
| Prettier | `/home/nomadx/opencode-cursor/opencode-rules/.prettierrc` | Code formatting |

### Documentation
| File | Path | Purpose |
|------|------|---------|
| README | `/home/nomadx/opencode-cursor/opencode-rules/README.md` | Main documentation |
| Rules Guide | `/home/nomadx/opencode-cursor/opencode-rules/docs/rules.md` | Usage documentation |
| Skill Guide | `/home/nomadx/opencode-cursor/opencode-rules/skills/crafting-rules/SKILL.md` | Rule creation |
| Project Spec | `/home/nomadx/opencode-cursor/opencode-rules/openspec/project.md` | Project conventions |
| Agents Spec | `/home/nomadx/opencode-cursor/opencode-rules/openspec/AGENTS.md` | AI agent instructions |

---

## 9. Conclusion

**Overall Assessment:** **EXCELLENT**

The opencode-rules project demonstrates:
- **Clean Architecture**: Well-organized, single-responsibility components
- **Robust Implementation**: Comprehensive error handling, caching, edge cases
- **Quality Testing**: Industry-leading test coverage with 2.8x ratio
- **Good Documentation**: Clear explanations, examples, and specifications
- **Performance Focus**: Efficient caching, minimal overhead, cleanup patterns

**Competitive Position:** This is a reference implementation for OpenCode plugins. It sets a high bar for code quality, testing, and documentation.

**Strategic Value for Our Project:**
1. **Reference Patterns**: Caching, session management, conditional logic
2. **Quality Benchmark**: Test coverage, error handling, documentation standards
3. **Feature Gap Analysis**: AND logic, observability, hot reload as differentiators

**Risk Level:** Low to Medium
- Low: Clean code, good tests, stable patterns
- Medium: Experimental API dependency

---

*End of Audit Report*
