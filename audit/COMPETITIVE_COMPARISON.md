# Competitive Analysis: Cursor-OpenCode Bridge Projects

## Executive Summary

This document compares 4 competing cursor-opencode bridge implementations against our `opencode-cursor` project to identify best practices, gaps, and opportunities for improvement.

## Projects Audited

| Project | Author | Approach | Lines of Code | Test Coverage |
|---------|--------|----------|---------------|---------------|
| **poso-cursor-auth** | POSO-PocketSolutions | HTTP Proxy Plugin | ~600 | None |
| **cursor-opencode-auth** | Infiland | Dual Tools + Provider | ~800 | None |
| **yet-another-opencode-cursor-auth** | Yukaii | Custom Fetch Handler | ~7,400 | Comprehensive |
| **opencode-rules** | frap129 | Rules Injection Plugin | ~800 | 87 tests |
| **opencode-cursor** | **Our Project** | **Direct Provider** | **~1,200** | **55 tests** |

---

## Detailed Comparison

### 1. Architecture Approaches

| Project | Architecture | Pros | Cons |
|---------|--------------|------|------|
| **poso-cursor-auth** | HTTP Proxy (port 32123) | Reuses OpenCode's provider infra, simple | Bun-only, E2BIG vulnerable, no streaming |
| **cursor-opencode-auth** | Git Worktree + HTTP Proxy | Sandboxed operations, dual mode (tools + provider) | Pseudo-streaming, no tests |
| **yet-another** | Custom Fetch Handler | No network overhead, sophisticated protocol | Complex, 3-6s latency per tool call |
| **opencode-rules** | Transform Hooks | Clean injection, excellent caching | Experimental API dependency |
| **OUR PROJECT** | **Direct Provider + Plugin** | **E2BIG protected, real streaming, both modes** | **Needs HTTP proxy option for compatibility** |

**Recommendation**: Our architecture is well-positioned. Consider adding HTTP proxy mode as optional fallback for maximum compatibility.

---

### 2. Feature Comparison Matrix

| Feature | poso | Infiland | Yukaii | frap129 | **OUR PROJECT** |
|---------|------|----------|--------|---------|-----------------|
| **E2BIG Protection** | ❌ CLI args | ❌ CLI args | ❌ CLI args | N/A | ✅ **Stdin-based** |
| **Real Streaming** | ❌ Pseudo | ❌ Pseudo | ✅ SSE | N/A | ✅ **Real** |
| **Tool Calling** | ✅ Prompt-based | ❌ | ✅ Native | N/A | ❌ **Planned** |
| **Session Management** | ❌ | ❌ | ✅ Complex | ✅ Context | ✅ **Basic** |
| **Metrics/Observability** | ❌ | ❌ | ✅ Timing | ❌ | ✅ **Built-in** |
| **Test Coverage** | ❌ 0% | ❌ 0% | ✅ High | ✅ 87 tests | ✅ **55 tests** |
| **Retry Logic** | ❌ | ❌ | ❌ | N/A | ✅ **Exponential backoff** |
| **Model Discovery** | ❌ Hardcoded | ❌ Hardcoded | ✅ Dynamic | N/A | ❌ **Hardcoded** |
| **Multi-Provider** | ❌ Cursor only | ❌ Cursor only | ✅ OpenAI/Anthropic/Gemini | N/A | ❌ **Cursor only** |
| **Auth Strategy** | ✅ Dual (SQLite + env) | ✅ OAuth | ✅ JWT refresh | N/A | ✅ **OAuth** |

**Key Insight**: We have the best E2BIG protection and real streaming. Yukaii has the most sophisticated protocol implementation but suffers from latency issues.

---

### 3. Code Quality Assessment

| Project | Grade | Strengths | Weaknesses |
|---------|-------|-----------|------------|
| **poso** | B | Clean TypeScript, platform paths | Bun-only, no tests |
| **Infiland** | B+ | Security-first, worktree sandbox | No tests, pseudo-streaming |
| **Yukaii** | A | Production-grade, comprehensive docs | Complex, latency issues |
| **frap129** | A | Excellent test ratio (2.8:1), caching | Experimental API dependency |
| **OUR PROJECT** | **B+** | **Good tests, clean architecture** | **Missing HTTP proxy, dynamic models** |

**Recommendation**: Target A-grade by adding HTTP proxy mode and dynamic model discovery.

---

### 4. Unique Strengths by Project

### poso-cursor-auth
1. **HTTP Proxy Pattern** - Clever reuse of OpenCode's provider infrastructure
2. **Dual Auth Strategy** - SQLite DB + cursor-agent auth file fallback
3. **Platform Paths** - Proper XDG_CONFIG_HOME, APPDATA handling
4. **Creative Tool Calling** - Prompt-based tool injection

### cursor-opencode-auth
1. **Git Worktree Sandboxing** - Isolates Cursor operations from workspace
2. **Dual Architecture** - Can use Cursor as both tool and provider
3. **Security-First** - Only documented Cursor surfaces, no reverse-engineering
4. **Cloud Agents** - Full lifecycle management

### yet-another-opencode-cursor-auth
1. **Custom Fetch Handler** - No network overhead vs proxy
2. **Protocol Excellence** - Full protobuf, gRPC-Web, SSE implementation
3. **Production Features** - JWT refresh, model discovery, token counting
4. **Comprehensive Testing** - Both unit and integration tests

### opencode-rules
1. **Transform Hooks** - Clean two-hook architecture
2. **Excellent Caching** - mtime-based invalidation
3. **Test Coverage** - 2.8:1 test-to-code ratio
4. **Conditional Logic** - Glob + keyword matching

### OUR PROJECT
1. **E2BIG Protection** - Only project with true stdin-based protection
2. **Real Streaming** - Actual streaming vs pseudo-streaming
3. **Session Management** - ACP-compliant session tracking
4. **Metrics Tracking** - Built-in prompt/tool call metrics
5. **Test Coverage** - 55 tests across all modules
6. **Retry Logic** - Exponential backoff with configurable options

---

### 5. Weaknesses/Gaps by Project

| Project | Critical Gaps |
|---------|---------------|
| **poso** | Bun-only, E2BIG vulnerable, no tests, no streaming |
| **Infiland** | No tests, pseudo-streaming, no tool calling |
| **Yukaii** | 3-6s latency per tool call, complex architecture |
| **frap129** | Experimental API, no hot reload, no metrics |
| **OUR PROJECT** | No HTTP proxy mode, hardcoded models, no tool calling bridge |

---

### 6. Recommendations for Our Project

#### Immediate Improvements (High Priority)

1. **Add HTTP Proxy Mode** (from poso/Infiland)
   - Provide dual-mode operation: direct provider + HTTP proxy
   - Increases compatibility with different OpenCode setups
   - Fallback option when direct mode has issues

2. **Dynamic Model Discovery** (from Yukaii)
   - Fetch available models from cursor-agent API
   - Auto-populate opencode.json models section
   - Eliminates manual model configuration

3. **Tool Calling Bridge** (from poso/Yukaii)
   - Implement OpenAI-compatible tool calling
   - Map OpenCode tools to cursor-agent exec calls
   - Critical for agent workflows

#### Medium-Term Improvements

4. **Git Worktree Sandboxing** (from Infiland)
   - Add optional sandboxing for risky operations
   - Prevents Cursor from modifying workspace directly
   - Security best practice

5. **Enhanced Session Management** (from Yukaii)
   - Session-aware tool call IDs
   - Better session reuse patterns
   - Reduce latency between calls

6. **Performance Timing** (from Yukaii)
   - Optional debug timing metrics
   - Track message build, SSE connection, first chunk
   - Helpful for debugging performance issues

#### Long-Term Improvements

7. **Multi-Provider Support** (from Yukaii)
   - Token counting for OpenAI, Anthropic, Gemini
   - Provider-aware request formatting
   - Future-proofing for other AI providers

8. **Hot Reload** (differentiate from frap129)
   - File watching for configuration changes
   - Dynamic model refresh
   - Better developer experience

9. **Circuit Breaker** (from Yukaii gaps)
   - Automatic error recovery
   - SSE reconnection logic
   - Resilience patterns

---

### 7. Competitive Positioning

#### Where We Lead
- ✅ **E2BIG Protection** - Only true stdin-based implementation
- ✅ **Test Coverage** - 55 tests (second only to frap129's 87)
- ✅ **Real Streaming** - Actual streaming vs pseudo-streaming
- ✅ **Session Management** - ACP-compliant implementation
- ✅ **Metrics** - Built-in tracking (no competitor has this)
- ✅ **Retry Logic** - Exponential backoff

#### Where We Lag
- ❌ **HTTP Proxy Mode** - poso/Infiland have this
- ❌ **Tool Calling** - poso/Yukaii have implementations
- ❌ **Dynamic Models** - Yukaii has auto-discovery
- ❌ **Protocol Depth** - Yukaii has full protobuf/gRPC-Web
- ❌ **Git Sandboxing** - Infiland has worktree pattern

#### Differentiation Strategy

**Position as**: "The Reliable, Production-Ready Bridge"

**Key Message**:
> "Zero E2BIG errors. Real streaming. 55 tests. Session management. Metrics. The only cursor bridge that handles large prompts reliably."

**Target Users**:
- Teams hitting E2BIG errors with other solutions
- Users needing real streaming (not pseudo-streaming)
- Projects requiring observability/metrics
- Teams wanting tested, reliable infrastructure

---

### 8. Implementation Roadmap

#### Phase 1: Core Improvements (1-2 weeks)
- [ ] Add HTTP proxy mode as optional feature
- [ ] Implement dynamic model discovery
- [ ] Add tool calling bridge

#### Phase 2: Reliability (2-3 weeks)
- [ ] Git worktree sandboxing option
- [ ] Enhanced session management
- [ ] Performance timing metrics

#### Phase 3: Advanced Features (4+ weeks)
- [ ] Multi-provider token counting
- [ ] Hot reload for config
- [ ] Circuit breaker patterns

---

## Conclusion

Our project has a **strong competitive position** with unique strengths in E2BIG protection, real streaming, and test coverage. The main gaps are HTTP proxy mode (for compatibility) and tool calling bridge (for agent workflows).

**Immediate priority**: Add HTTP proxy mode and tool calling to close the gap with competitors while maintaining our reliability advantages.

**Long-term**: Leverage our testing foundation to become the most reliable, production-ready cursor bridge available.

---

*Generated: 2026-01-29*
*Audits: poso-cursor-auth, cursor-opencode-auth, yet-another-opencode-cursor-auth, opencode-rules*
