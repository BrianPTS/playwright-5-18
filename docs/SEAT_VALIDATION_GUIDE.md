# Enhanced Seat Validation System

## Overview
The seat validation system prevents false deletions/updates from incomplete Ticketmaster data by tracking historical seat counts and flagging suspicious fluctuations for delayed retry.

## Key Features

### 1. **Asymmetric Validation**
- **Seat Increases**: Always accepted (no validation needed)
- **Small Decreases (< 50%)**: Accepted as normal fluctuation
- **Large Decreases (> 50%)**: Trigger validation with trend analysis

### 2. **Trend Analysis (NEW)**
- Tracks consecutive seat count readings to distinguish between:
  - **Temporary API glitches** (bounce back to normal)
  - **Legitimate inventory changes** (sustained drop)

### 3. **Validation Process**

#### Initial Detection
1. Seat count drops > 50% from previous count
2. Previous count must be >= 10 seats
3. First drop → Reject data, delay for 30s, start trend tracking

#### Trend Confirmation
1. After delay, event is retried
2. If still showing > 40% drop → Track as 2nd confirmation
3. After 3rd consecutive confirmation (> 40% drop each time):
   - **Accept the new lower count as legitimate**
   - Update database with new seat count
   - Clear trend tracking

#### Example Scenarios

```
Scenario 1: API Glitch (Temporary)
- 1000 seats → 300 seats (1st check: Reject, delay 30s)
- 1000 seats → 950 seats (2nd check: Normal, accepted)
- Result: Original 1000 seats preserved

Scenario 2: Legitimate Release
- 1000 seats → 400 seats (1st check: Reject, delay 30s)
- 1000 seats → 420 seats (2nd check: Reject, delay 30s)
- 1000 seats → 410 seats (3rd check: Accept at 410 seats)
- Result: New 410 seats accepted as legitimate
```

### 4. **Configuration Options**

```javascript
const seatValidator = new SeatCountValidator({
  fluctuationThreshold: 0.5,        // 50% drop triggers validation
  minSeatsForValidation: 10,        // Only validate if previous count >= 10
  delayDuration: 30000,             // 30 seconds delay between checks
  maxHistoryAge: 24 * 60 * 60 * 1000, // 24 hours history retention
  trendCheckCount: 3,               // Require 3 consecutive checks
  trendAcceptanceThreshold: 0.4     // Accept after 40% sustained drop
});
```

### 5. **Integration Points**

#### In scraper.js
```javascript
const validation = await seatValidator.validateSeatCount(eventId, seatCount);

if (!validation.isValid && validation.shouldDelay) {
  // Creates special error for scraperManager
  const delayError = new Error(`SEAT_COUNT_FLUCTUATION: ${validation.message}`);
  delayError.isFluctuationError = true;
  delayError.delayUntil = validation.delayUntil;
  delayError.trendCheck = validation.trendCheck; // e.g., "2/3"
  throw delayError;
}
```

#### In scraperManager.js
```javascript
if (error.isFluctuationError) {
  const trendInfo = error.trendCheck ? ` (${error.trendCheck})` : '';
  console.log(`⚠️ Seat count fluctuation: ${error.previousCount} → ${error.seatCount} seats${trendInfo}`);
  
  // Add to cooldown for retry
  this.cooldownEvents.set(eventId, error.delayUntil);
  return false; // Retry later
}
```

### 6. **Database Schema**

The `SeatValidation` model tracks:
- `eventId`: Unique event identifier
- `seatCount`: Last accepted seat count
- `previousCount`: Previous seat count before last update
- `fluctuationCount`: Number of fluctuations detected
- `delayedUntil`: Timestamp for retry delay
- `lastFluctuation`: Last fluctuation detection time
- `validationCount`: Total validation attempts

### 7. **Monitoring & Logs**

#### Validation Success
```
✓ CONFIRMED TREND for event123: Sustained drop over 3 checks. Accepting 410 seats (was 1000)
Event event123 scrape successful - 410 seat groups found (validation: confirmed_trend, fluctuation: 59%)
```

#### Validation In Progress
```
⚠️ SUSPICIOUS FLUCTUATION for event123: 1000 → 400 seats (60% drop) - Check 2/3 - REJECTING DATA
⚠️ Seat count fluctuation detected for event123: 1000 → 400 seats (2/3). Delaying for 30s
```

#### Normal Fluctuation
```
Event event123 scrape successful - 950 seat groups found (validation: normal_fluctuation, fluctuation: 5%)
```

### 8. **Benefits**

1. **Prevents False Deletions**: Temporary API glitches don't overwrite good data
2. **Adapts to Legitimate Changes**: Real inventory drops are accepted after confirmation
3. **Minimal Performance Impact**: Only delays on large drops, normal flow unaffected
4. **Self-Healing**: Automatically recovers from both scenarios
5. **Full Visibility**: Clear logging shows what's happening and why

### 9. **Maintenance**

- **Automatic Cleanup**: Old history and trend data cleaned hourly
- **Memory Efficient**: Trend tracking uses minimal memory with TTL
- **MongoDB Coordination**: Works across multiple instances via shared database

### 10. **Troubleshooting**

#### Events Stuck in Delay
- Check if trend data is accumulating: `seatValidator.consecutiveCounts`
- Manually clear delay: `await seatValidator.clearDelay(eventId)`
- Force update if needed: `await seatValidator.forceUpdateSeatCount(eventId, newCount)`

#### Too Many False Positives
- Increase `fluctuationThreshold` (e.g., from 0.5 to 0.6)
- Increase `trendCheckCount` (e.g., from 3 to 4)
- Decrease `trendAcceptanceThreshold` (e.g., from 0.4 to 0.3)

#### Too Slow to Accept Legitimate Drops
- Decrease `delayDuration` (e.g., from 30000 to 15000)
- Decrease `trendCheckCount` (e.g., from 3 to 2)
- Increase `trendAcceptanceThreshold` (e.g., from 0.4 to 0.45)
