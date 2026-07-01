# 🐛 Bug Analysis Report - M00NK1DD-B0T_

**Generated:** 2026-07-01  
**Repository:** arand606/M00NK1DD-B0T_  
**Language:** JavaScript (100%)

---

## Executive Summary

This document outlines **critical issues**, **bugs**, and **code quality concerns** found in the M00NK1DD-B0T_ codebase. The analysis covers the main application flow, database abstraction, error handling, and utility functions. Issues are categorized by severity.

---

## 🔴 CRITICAL ISSUES

### 1. **Unsafe CORS Configuration** 
**File:** `src/app.js` (Lines 113-127)  
**Severity:** HIGH  
**Impact:** Security vulnerability; potential for CORS bypass

```javascript
// ❌ PROBLEMATIC CODE
const allowedOrigins = Array.isArray(corsOrigin) ? corsOrigin : [corsOrigin];
const origin = req.headers.origin;

if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
  res.header('Access-Control-Allow-Origin', origin || '*');
}
```

**Problems:**
- When `corsOrigin` is `'*'`, the condition checks if an array contains the string `'*'`
- Setting `Access-Control-Allow-Origin: *` with credentials enabled violates CORS spec
- The wildcard `'*'` in `allowedOrigins` array is treated as a literal string, not a pattern match

**Fix:**
```javascript
const allowedOrigins = Array.isArray(corsOrigin) ? corsOrigin : [corsOrigin];
const origin = req.headers.origin;
const hasWildcard = allowedOrigins.includes('*');

if (hasWildcard) {
  res.header('Access-Control-Allow-Origin', '*');
} else if (allowedOrigins.includes(origin)) {
  res.header('Access-Control-Allow-Origin', origin);
}
```

---

### 2. **Memory Leak in Rate Limiter**
**File:** `src/app.js` (Lines 129-151)  
**Severity:** HIGH  
**Impact:** Memory exhaustion under sustained load

```javascript
// ❌ PROBLEMATIC CODE
const requestCounts = new Map();
app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const windowStart = now - windowMs;
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }
  
  const times = requestCounts.get(ip).filter(t => t > windowStart);
  times.push(now);
  requestCounts.set(ip, times);  // ❌ OLD ENTRIES ACCUMULATE
  next();
});
```

**Problems:**
- IPs with `times.length === 0` remain as keys in the Map with empty arrays
- Over time with many unique IPs, the Map grows unboundedly
- No garbage collection mechanism for old or stale entries

**Fix:**
```javascript
const requestCounts = new Map();
app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const windowStart = now - windowMs;
  
  let times = requestCounts.get(ip) || [];
  times = times.filter(t => t > windowStart);
  
  if (times.length >= maxRequests) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  times.push(now);
  
  // Only store if times exist, otherwise cleanup
  if (times.length > 0) {
    requestCounts.set(ip, times);
  } else {
    requestCounts.delete(ip);
  }
  
  next();
});
```

---

### 3. **Type Error in Handler Loader**
**File:** `src/app.js` (Lines 281-283)  
**Severity:** MEDIUM-HIGH  
**Impact:** Runtime error when handler type contains colon

```javascript
// ❌ PROBLEMATIC CODE
const loaderFn = handler.type.startsWith('named:') 
  ? module[handler.type.split(':')[1]]  // ❌ UNDEFINED if no colon or no [1]
  : module.default;
```

**Problems:**
- `handler.type.split(':')` may return array with only one element
- Accessing `[1]` on a single-element array returns `undefined`
- No validation that the split actually produced a named export
- If `handler.type` is `'named'` (missing colon), `split(':')` returns `['named']` and `[1]` is undefined

**Example fail case:**
```javascript
const handler = { path: 'events', type: 'named', required: true };
// handler.type.startsWith('named:') === false
// Falls through to module.default ✓ OK
// BUT if type is 'named:myExport':
// handler.type.split(':')[1] === 'myExport' ✓
// BUT if split returns only 1 element:
// module[undefined] throws or returns undefined ❌
```

**Fix:**
```javascript
let loaderFn;
if (handler.type.startsWith('named:')) {
  const parts = handler.type.split(':');
  if (parts.length < 2 || !parts[1]) {
    throw new Error(`Invalid handler type format: "${handler.type}". Expected "named:exportName"`);
  }
  loaderFn = module[parts[1]];
  if (!loaderFn) {
    throw new Error(`Export "${parts[1]}" not found in ${handler.path}`);
  }
} else {
  loaderFn = module.default;
}
```

---

## 🟠 HIGH-PRIORITY ISSUES

### 4. **Unvalidated Port Binding Errors**
**File:** `src/app.js` (Lines 203-224)  
**Severity:** MEDIUM  
**Impact:** Fails silently on permission errors

```javascript
// ❌ PROBLEMATIC CODE
server.on('error', (error) => {
  const errorCode = error?.code || 'UNKNOWN_ERROR';
  
  if (!hasStartedListening && errorCode === 'EADDRINUSE' && attempt < maxPortRetryAttempts) {
    // Retry logic ✓
  }
  
  if (hasStartedListening && errorCode === 'EADDRINUSE') {
    logger.warn('...duplicate bind warning...');
    return; // ❌ Silently returns on port conflict AFTER binding
  }
  
  logger.error(`Web server error: ${errorMessage}`);
  // ❌ No handling for EACCES, EPERM, or other OS errors
});
```

**Problems:**
- Only handles `EADDRINUSE` and `UNKNOWN_ERROR`
- Doesn't handle `EACCES` (permission denied), `EPERM` (operation not permitted)
- Silently returns if server started but port becomes unavailable
- No retry for permission-related errors

**Likely scenarios:**
- Port < 1024 requires root/admin
- Firewall blocking port
- Previous process still holding port

**Fix:**
```javascript
const OS_ERRORS = {
  'EADDRINUSE': 'Port is already in use',
  'EACCES': 'Permission denied (port < 1024 requires elevated privileges)',
  'EPERM': 'Operation not permitted',
  'ENOTFOUND': 'Host not found',
  'EHOSTUNREACH': 'Host is unreachable',
};

server.on('error', (error) => {
  const errorCode = error?.code || 'UNKNOWN_ERROR';
  const errorMsg = OS_ERRORS[errorCode] || error.message;
  
  if (!hasStartedListening && errorCode === 'EADDRINUSE' && attempt < maxPortRetryAttempts) {
    startupLog(`Port ${port} in use. Retrying on ${port + 1}...`);
    setTimeout(() => startServer(port + 1, attempt + 1), 250);
    return;
  }
  
  if (!hasStartedListening && errorCode === 'EACCES') {
    logger.error(`❌ Cannot bind to port ${port}: ${errorMsg}`);
    process.exit(1);
  }
  
  logger.error(`❌ Web server error (${errorCode}): ${errorMsg}`);
  if (!hasStartedListening) process.exit(1);
});
```

---

### 5. **Race Condition in Counter Updates**
**File:** `src/app.js` (Lines 236-270)  
**Severity:** MEDIUM  
**Impact:** Data inconsistency; orphaned counters

```javascript
// ⚠️ PROBLEMATIC CODE - Race condition possible
for (const [guildId, guild] of this.guilds.cache) {
  const counters = await getServerCounters(this, guildId);
  
  for (const counter of counters) {
    const channel = guild.channels.cache.get(counter.channelId);
    if (channel) {
      // Counter is valid
    } else {
      // Channel deleted, but what if it's recreated between checks?
      orphanedCounters.push(counter);
    }
  }
  
  if (orphanedCounters.length > 0) {
    await saveServerCounters(this, guildId, validCounters);
  }
}
```

**Problems:**
- Between `getServerCounters()` and `saveServerCounters()`, the guild state can change
- A channel may be deleted and recreated
- Multiple cron jobs could run simultaneously, causing conflicts

**Fix:** Use mutex or transaction-like behavior (the codebase has `Mutex` at `src/utils/mutex.js`):
```javascript
import { Mutex } from './utils/mutex.js';

async updateAllCounters() {
  for (const [guildId, guild] of this.guilds.cache) {
    // Lock per guild to prevent concurrent updates
    await Mutex.runExclusive(`counter:${guildId}`, async () => {
      const counters = await getServerCounters(this, guildId);
      const validCounters = [];
      
      for (const counter of counters) {
        if (counter?.type && counter?.channelId && counter.enabled !== false) {
          const channel = guild.channels.cache.get(counter.channelId);
          if (channel) {
            validCounters.push(counter);
            await updateCounter(this, guild, counter);
          }
        }
      }
      
      await saveServerCounters(this, guildId, validCounters);
    });
  }
}
```

---

### 6. **Database Status Check Ambiguity**
**File:** `src/app.js` (Lines 154-183)  
**Severity:** MEDIUM  
**Impact:** Misleading health checks

```javascript
// ❌ PROBLEMATIC CODE
app.get('/ready', (req, res) => {
  const dbStatus = this.db?.getStatus?.() || { isDegraded: true };  // ⚠️ Defaults to degraded
  const isReady = this.isReady() && !dbStatus.isDegraded;
  
  if (isReady) {
    return res.status(200).json({ ready: true, message: 'Bot is ready' });
  }
  
  res.status(503).json({
    ready: false,
    reason: !this.isReady() ? 'Bot not Ready' : 'Database degraded'
  });
});
```

**Problems:**
- Defaults to `{ isDegraded: true }` if `this.db` is undefined
- This causes `/ready` to return 503 even if bot is actually initializing normally
- No distinction between "database missing" and "database degraded"
- Unclear whether this is during startup (expected) or runtime (problem)

**Fix:**
```javascript
app.get('/ready', (req, res) => {
  if (!this.db) {
    return res.status(503).json({
      ready: false,
      reason: 'Database not initialized'
    });
  }
  
  const dbStatus = this.db.getStatus();
  const isReady = this.isReady() && !dbStatus.isDegraded;
  
  if (isReady) {
    return res.status(200).json({
      ready: true,
      message: 'Bot is ready',
      database: dbStatus.connectionType
    });
  }
  
  res.status(503).json({
    ready: false,
    reason: !this.isReady() ? 'Bot not ready' : 'Database degraded',
    database: dbStatus
  });
});
```

---

## 🟡 MEDIUM-PRIORITY ISSUES

### 7. **Missing Null Checks in Database Wrapper**
**File:** `src/utils/database.js` (Lines 105-112)  
**Severity:** MEDIUM  
**Impact:** Potential runtime errors

```javascript
// ⚠️ PROBLEMATIC CODE
async increment(key, amount = 1) {
  if (this.db.increment) {  // ❌ No null check on this.db
    return this.db.increment(key, amount);
  }
  const current = await this.db.get(key, 0);  // ❌ What if this.db is null?
  const newValue = current + amount;
  await this.db.set(key, newValue);
  return newValue;
}
```

**Problems:**
- If `this.db` is null, `this.db.increment` throws
- Multiple methods lack null checks on `this.db`
- No guard clause at method entry

**Fix:**
```javascript
async increment(key, amount = 1) {
  if (!this.db) {
    throw new Error('Database not initialized');
  }
  
  if (typeof this.db.increment === 'function') {
    return this.db.increment(key, amount);
  }
  
  const current = await this.db.get(key, 0);
  const newValue = current + amount;
  await this.db.set(key, newValue);
  return newValue;
}
```

---

### 8. **Improper Error Propagation in Event Handler**
**File:** `src/handlers/events.js` (Lines 16-23)  
**Severity:** MEDIUM  
**Impact:** Silent event failures

```javascript
// ⚠️ PROBLEMATIC CODE
const safeExecute = async (...args) => {
  try {
    await event.execute(...args, client);
  } catch (error) {
    logger.error(`Error executing event ${event.name}:`, error);
    // ❌ Error swallowed, not re-thrown or handled further
  }
};
```

**Problems:**
- Events that fail are logged but not tracked
- No way to know if critical events failed
- No circuit breaker or fallback

**Better approach:**
```javascript
const safeExecute = async (...args) => {
  try {
    await event.execute(...args, client);
  } catch (error) {
    logger.error(`Error executing event ${event.name}:`, error);
    
    // For critical events, consider re-throwing
    const criticalEvents = new Set(['ready', 'guildCreate', 'guildDelete']);
    if (criticalEvents.has(event.name) && client.skipCriticalEventErrors !== true) {
      throw error;  // Re-throw to halt startup
    }
  }
};
```

---

### 9. **Unvalidated Application Status Values**
**File:** `src/utils/database.js` (Lines 1268-1276)  
**Severity:** MEDIUM  
**Impact:** Data corruption; invalid states

```javascript
// ⚠️ PROBLEMATIC CODE
const status = typeof application.status === 'string' ? application.status.toLowerCase() : 'pending';

if (status === 'pending') {
  return ageMsFromCreated > pendingRetentionMs;
}

if (status === 'approved' || status === 'denied') {  // ⚠️ What about other values?
  return ageMsFromReviewed > reviewedRetentionMs;
}

return ageMsFromCreated > pendingRetentionMs;  // ⚠️ Default fallback
```

**Problems:**
- Accepts any string as status (no validation)
- No enum or constant for valid statuses
- Database could contain `status: 'invalid'` or `status: 'PENDING'` (uppercase)
- Default behavior may not be what's intended

**Fix:**
```javascript
const VALID_STATUSES = ['pending', 'approved', 'denied', 'rejected'];

function isApplicationExpired(application, retentionDays, now = Date.now()) {
  if (!application || typeof application !== 'object') {
    return false;
  }
  
  const rawStatus = application.status;
  const status = typeof rawStatus === 'string' 
    ? rawStatus.toLowerCase().trim() 
    : 'pending';
  
  if (!VALID_STATUSES.includes(status)) {
    logger.warn(`Invalid application status: "${rawStatus}". Treating as pending.`);
  }
  
  // ... rest of logic
}
```

---

### 10. **Missing Request Timeout Configuration**
**File:** `src/app.js` (Lines 106-228)  
**Severity:** MEDIUM  
**Impact:** Hanging requests; resource exhaustion

```javascript
// ⚠️ INCOMPLETE CODE
const app = express();
// ❌ No timeout configuration
app.use((req, res, next) => {
  // Rate limiting, CORS, etc.
  next();
});

const server = app.listen(port, host, () => {
  // ❌ No keepAliveTimeout or requestTimeout
});
```

**Problems:**
- Requests can hang indefinitely
- Slow clients can hold connections open
- No protection against slowloris attacks

**Fix:**
```javascript
const app = express();

// Add timeout middleware
app.use((req, res, next) => {
  req.setTimeout(30000);  // 30 seconds per request
  res.setTimeout(30000);
  next();
});

// ... other middleware

const server = app.listen(port, host, () => {
  server.keepAliveTimeout = 65000;
  server.requestTimeout = 60000;
  startupLog(`✅ Web Server running on ${host}:${port}`);
});
```

---

## 🟢 LOW-PRIORITY ISSUES

### 11. **Redundant Console Transport in Logger**
**File:** `src/utils/logger.js` (Lines 154-174)  
**Severity:** LOW  
**Impact:** Code duplication

```javascript
// ⚠️ REDUNDANT CODE
if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), logFormat),
    level: resolvedLogLevel,
  }));
} else {
  logger.add(new transports.Console({  // ❌ EXACT SAME CONFIG
    format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), logFormat),
    level: resolvedLogLevel,
  }));
}
```

**Fix:**
```javascript
const consoleTransport = new transports.Console({
  format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), logFormat),
  level: resolvedLogLevel,
});
logger.add(consoleTransport);
```

---

### 12. **Excessive Modlog Settings Duplication**
**File:** `src/utils/database.js` (Lines 1656-1789)  
**Severity:** LOW  
**Impact:** Maintenance burden; inconsistency risk

```javascript
// ⚠️ PROBLEMATIC PATTERN
const defaultSettings = {
  logBans: true,
  logKicks: true,
  logMutes: true,
  // ... 50+ similar boolean flags ...
  logGuildScheduledEventUsersUpdate: true,
};

// Repeated again in error case:
return {
  logBans: true,
  logKicks: true,
  // ... ALL REPEATED ...
};
```

**Problems:**
- Defaults defined in two places
- Hard to maintain consistency
- Prone to drift between versions

**Fix:**
```javascript
const DEFAULT_MODLOG_SETTINGS = {
  enabled: false,
  channelId: null,
  ignoredChannels: [],
  ignoredUsers: [],
  ignoredActions: [],
  logActions: {
    bans: true,
    kicks: true,
    mutes: true,
    warns: true,
    // ...
  }
};

export async function getModlogSettings(client, guildId) {
  const key = getModlogSettingsKey(guildId);
  try {
    const settings = await client.db.get(key, {});
    return { ...DEFAULT_MODLOG_SETTINGS, ...unwrapReplitData(settings) };
  } catch (error) {
    logger.error(`Error getting modlog settings for guild ${guildId}:`, error);
    return DEFAULT_MODLOG_SETTINGS;
  }
}
```

---

### 13. **Hardcoded String Values for Logging**
**File:** `src/app.js` (Various lines)  
**Severity:** LOW  
**Impact:** Inconsistent log messages; hard to search/standardize

```javascript
// ⚠️ SCATTERED STRINGS
logger.info('✅ Database Status: ...');
startupLog('Starting TitanBot...');
logger.error('❌ Database Initialization Error:', error);
shutdownLog('Bot stopped successfully.');
```

**Recommendation:** Extract to constants:
```javascript
const LOG_MESSAGES = {
  DATABASE_INIT_START: 'Initializing database...',
  DATABASE_INIT_SUCCESS: '✅ Database initialized',
  DATABASE_INIT_ERROR: '❌ Database Initialization Error:',
  BOT_STARTUP: 'Starting TitanBot...',
  BOT_ONLINE: 'ONLINE ✅',
  BOT_SHUTDOWN: 'Bot is shutting down',
};
```

---

## 📋 Summary Table

| Issue | File | Severity | Type | Recommendation |
|-------|------|----------|------|-----------------|
| Unsafe CORS | app.js | 🔴 CRITICAL | Security | Fix wildcard handling |
| Rate Limiter Memory Leak | app.js | 🔴 CRITICAL | Performance | Add cleanup logic |
| Handler Type Error | app.js | 🟠 HIGH | Runtime | Add validation |
| Port Binding Errors | app.js | 🟠 HIGH | Reliability | Handle OS errors |
| Counter Race Condition | app.js | 🟠 HIGH | Data Integrity | Use Mutex |
| DB Status Ambiguity | app.js | 🟠 HIGH | Observability | Clarify states |
| Missing Null Checks | database.js | 🟡 MEDIUM | Runtime | Add guards |
| Event Error Swallowing | events.js | 🟡 MEDIUM | Debugging | Improve tracking |
| Invalid Status Values | database.js | 🟡 MEDIUM | Data Integrity | Add enum validation |
| Missing Timeouts | app.js | 🟡 MEDIUM | Security | Configure limits |
| Redundant Logger Config | logger.js | 🟢 LOW | Quality | DRY principle |
| Modlog Settings Duplication | database.js | 🟢 LOW | Maintainability | Extract constant |
| Hardcoded Strings | app.js | 🟢 LOW | Standards | Use constants |

---

## ✅ Recommendations

1. **Immediate (This week):**
   - [ ] Fix CORS configuration (Issue #1)
   - [ ] Implement rate limiter cleanup (Issue #2)
   - [ ] Add handler type validation (Issue #3)

2. **Short-term (This sprint):**
   - [ ] Enhance port binding error handling (Issue #4)
   - [ ] Add mutex-based counter updates (Issue #5)
   - [ ] Clarify database status checks (Issue #6)

3. **Medium-term (Next sprint):**
   - [ ] Add comprehensive null checks (Issue #7)
   - [ ] Improve event error handling (Issue #8)
   - [ ] Add status enum validation (Issue #9)

4. **Long-term (Ongoing):**
   - [ ] Add request timeouts (Issue #10)
   - [ ] Refactor for DRY principles (Issues #11-13)
   - [ ] Add integration tests
   - [ ] Implement request/response middleware logging

---

## 📚 Related Files for Reference

- **Main entry:** `src/app.js`
- **Database:** `src/utils/database.js`
- **Logger:** `src/utils/logger.js`
- **Event handlers:** `src/handlers/events.js`
- **Error handling:** `src/utils/errorHandler.js`
- **Mutex utility:** `src/utils/mutex.js` (already implements locking!)

---

**Report prepared:** 2026-07-01  
**Status:** Initial Assessment  
**Next Review:** After critical issues are resolved
