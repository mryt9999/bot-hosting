# Balance Management Refactoring Guide

## Overview
This codebase now uses centralized utility functions for all balance changes to ensure consistency and prevent bugs.

## Utility Functions

All balance-changing code should use the utilities in `utils/dbUtils.js`:

### `updateBalance(userId, amount, context, options)`
Updates a user's balance by a specific amount (positive or negative).

**Parameters:**
- `userId` (string): Discord user ID
- `amount` (number): Amount to add/subtract (negative for deductions)
- `context` (object): Contains `interaction` or `client` for event firing
- `options` (object):
  - `serverId` (string|null): Server ID for profile creation
  - `checkBalance` (boolean): Verify sufficient funds for negative amounts (default: true)
  - `session` (object|null): Mongoose session for transactions
  - `skipBalanceEvent` (boolean): Skip firing balance change event (default: false)

**Returns:** `{ success, profile, newBalance, reason, error }`

**Example:**
```javascript
const result = await updateBalance(
    userId, 
    100, 
    { interaction },
    { serverId: interaction.guild?.id }
);
if (!result.success) {
    console.error('Balance update failed:', result.reason);
}
```

### `setBalance(userId, newBalance, context, options)`
Sets a user's balance to a specific value.

**Parameters:**
- `userId` (string): Discord user ID
- `newBalance` (number): New balance value (must be >= 0)
- `context` (object): Contains `interaction` or `client` for event firing
- `options` (object): Same as updateBalance

**Returns:** `{ success, profile, newBalance, reason, error }`

**Example:**
```javascript
const result = await setBalance(userId, 0, { interaction });
```

### `transferPoints(senderId, receiverId, amount, context)`
Atomically transfers points between two users.

**Parameters:**
- `senderId` (string): Discord user ID of sender
- `receiverId` (string): Discord user ID of receiver
- `amount` (number): Amount to transfer (must be positive)
- `context` (object): Contains `interaction` or `client` for event firing

**Returns:** `{ success, sender, receiver, reason, error }`

**Example:**
```javascript
const result = await transferPoints(
    senderId, 
    receiverId, 
    100, 
    { interaction }
);
```

## Automatic Features

All utility functions automatically:
1. ✅ Validate inputs
2. ✅ Create user profiles if they don't exist
3. ✅ Fire balance change events (triggers role updates, loan repayments)
4. ✅ Return detailed error information
5. ✅ Handle database transactions

## Best Practices

### DO ✅
- Use `updateBalance()` for single-user balance changes
- Use `setBalance()` for resetting balances
- Use `transferPoints()` for transfers between users
- Always check the `success` field in the result
- Pass `interaction` or `client` in context for event firing

### DON'T ❌
- Never directly modify `profileData.balance`
- Never use MongoDB `$inc` or `$set` for balance
- Never manually call `balanceChangeEvent.execute()`
- Never skip error checking

## Migration from Old Code

### Before (Old Pattern):
```javascript
await profileModel.findOneAndUpdate(
    { userId: userId },
    { $inc: { balance: amount } }
);
const member = await guild.members.fetch(userId);
balanceChangeEvent.execute(member);
```

### After (New Pattern):
```javascript
const result = await updateBalance(userId, amount, { interaction });
if (!result.success) {
    // Handle error
}
```

## Commands Updated

The following commands have been refactored to use these utilities:
- `/gamble` - Uses `updateBalance()`
- `/daily` - Uses `updateBalance()`
- `/donate` - Uses `transferPoints()`
- `/admin addpoints` - Uses `updateBalance()`
- `/admin subtractpoints` - Uses `updateBalance()`
- `/admin resetpoints` - Uses `setBalance()`
- `/admin givetask` - Uses `updateBalance()`
- `/admin withdrawfrom` - Uses `updateBalance()`
- `/transfer make` - Uses `updateBalance()`
- `/loan accept` - Uses `transferPoints()`
- `/loan repay` - Uses `transferPoints()`

## Events Updated

- `ArcaneRoleReward` - Uses `updateBalance()`
- `lastMessage` (daily role pay) - Uses `updateBalance()`

## Bug Fixes

The refactoring also fixed a bug in `events/lastMessage.js` where balance change events were not being fired for daily role pay rewards.
