// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./IdentityRegistry.sol";

/**
 * @title SpendingPolicy
 * @notice Enforces spending policies based on ZK identity tiers.
 *         Provides pre-execution checks, rate limiting, and replay protection.
 */
contract SpendingPolicy is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    IdentityRegistry public identityRegistry;

    // Rate limiting: max transactions per hour per user
    mapping(IdentityRegistry.Tier => uint256) public txPerHourLimit;
    mapping(address => uint256) public hourlyTxCount;
    mapping(address => uint256) public lastTxHourReset;

    // Replay protection
    mapping(bytes32 => bool) public executedNonces;

    // Allowlisted recipients (for higher-trust transfers)
    mapping(address => mapping(address => bool)) public allowlisted;

    // Global daily volume cap (circuit breaker)
    uint256 public globalDailyVolume;
    uint256 public globalDailyLimit;
    uint256 public lastGlobalReset;

    event PolicyChecked(address indexed user, uint256 amount, bool approved, string reason);
    event RecipientAllowlisted(address indexed user, address indexed recipient, bool status);
    event GlobalLimitUpdated(uint256 newLimit);

    error PolicyViolation(string reason);
    error ReplayDetected();
    error GlobalLimitBreached();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address admin,
        address _identityRegistry
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(EXECUTOR_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);

        identityRegistry = IdentityRegistry(_identityRegistry);

        txPerHourLimit[IdentityRegistry.Tier.NONE] = 5;
        txPerHourLimit[IdentityRegistry.Tier.BASIC] = 20;
        txPerHourLimit[IdentityRegistry.Tier.ADVANCED] = 100;

        globalDailyLimit = 1_000_000 * 1e18; // $1M circuit breaker
        lastGlobalReset = block.timestamp;
    }

    /**
     * @notice Full policy check before executing a payment.
     * @param user Sender address
     * @param amount Transfer amount in mUSD
     * @param recipient Recipient address
     * @param nonce Unique nonce for replay protection
     * @return approved Whether the transaction passes all checks
     */
    function checkPolicy(
        address user,
        uint256 amount,
        address recipient,
        bytes32 nonce
    ) external onlyRole(EXECUTOR_ROLE) whenNotPaused returns (bool approved) {
        // 1. Replay protection
        if (executedNonces[nonce]) revert ReplayDetected();
        executedNonces[nonce] = true;

        // 2. Global circuit breaker
        _checkGlobalLimit(amount);

        // 3. Rate limiting
        _checkRateLimit(user);

        // 4. Spending limit (delegates to IdentityRegistry)
        identityRegistry.recordSpend(user, amount);

        // 5. Recipient validation (optional allowlist for large amounts)
        IdentityRegistry.Tier tier = identityRegistry.getUserTier(user);
        if (tier == IdentityRegistry.Tier.NONE && amount > 25 * 1e18) {
            // Tier 0 users sending >$25 must have allowlisted recipient
            if (!allowlisted[user][recipient]) {
                revert PolicyViolation("Tier 0: recipient not allowlisted for amounts > $25");
            }
        }

        emit PolicyChecked(user, amount, true, "approved");
        return true;
    }

    function _checkRateLimit(address user) internal {
        if (block.timestamp - lastTxHourReset[user] >= 1 hours) {
            hourlyTxCount[user] = 0;
            lastTxHourReset[user] = block.timestamp;
        }

        IdentityRegistry.Tier tier = identityRegistry.getUserTier(user);
        uint256 limit = txPerHourLimit[tier];

        if (hourlyTxCount[user] >= limit) {
            revert PolicyViolation("Hourly transaction limit exceeded");
        }

        hourlyTxCount[user]++;
    }

    function _checkGlobalLimit(uint256 amount) internal {
        if (block.timestamp - lastGlobalReset >= 1 days) {
            globalDailyVolume = 0;
            lastGlobalReset = block.timestamp;
        }

        if (globalDailyVolume + amount > globalDailyLimit) {
            revert GlobalLimitBreached();
        }

        globalDailyVolume += amount;
    }

    /**
     * @notice Allowlist a recipient for a user (reduces friction for recurring sends).
     */
    function setAllowlist(address recipient, bool status) external {
        allowlisted[msg.sender][recipient] = status;
        emit RecipientAllowlisted(msg.sender, recipient, status);
    }

    function setGlobalDailyLimit(uint256 limit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        globalDailyLimit = limit;
        emit GlobalLimitUpdated(limit);
    }

    function setTxPerHourLimit(IdentityRegistry.Tier tier, uint256 limit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        txPerHourLimit[tier] = limit;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
