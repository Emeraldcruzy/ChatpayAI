// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title IdentityRegistry
 * @notice Manages ZK identity tiers for MantleGuard users.
 *         Tier 0: No proof ($50/day), Tier 1: Basic ZK ($500/day), Tier 2: Advanced ZK (unlimited)
 * @dev Deployed on Mantle L2. Upgrade-safe via UUPS pattern.
 */
contract IdentityRegistry is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    enum Tier { NONE, BASIC, ADVANCED }

    struct Identity {
        Tier tier;
        uint256 proofTimestamp;
        bytes32 nullifier;        // prevents proof reuse
        uint256 expiresAt;        // proof expiry
        uint256 dailySpent;       // rolling 24h spend tracker
        uint256 lastSpendReset;   // timestamp of last reset
    }

    mapping(address => Identity) public identities;
    mapping(bytes32 => bool) public usedNullifiers;

    // Spending limits per tier (in mUSD with 18 decimals)
    mapping(Tier => uint256) public tierLimits;

    event TierUpgraded(address indexed user, Tier oldTier, Tier newTier, bytes32 nullifier);
    event TierRevoked(address indexed user, Tier oldTier);
    event SpendRecorded(address indexed user, uint256 amount, uint256 newDailyTotal);
    event TierLimitUpdated(Tier tier, uint256 newLimit);

    error NullifierAlreadyUsed();
    error InvalidTier();
    error ProofExpired();
    error SpendingLimitExceeded(uint256 requested, uint256 remaining);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);

        // Default limits: 50 mUSD, 500 mUSD, type(uint256).max
        tierLimits[Tier.NONE] = 50 * 1e18;
        tierLimits[Tier.BASIC] = 500 * 1e18;
        tierLimits[Tier.ADVANCED] = type(uint256).max;
    }

    /**
     * @notice Upgrade a user's identity tier after ZK proof verification.
     * @param user The user address
     * @param newTier The tier to upgrade to
     * @param nullifier Unique proof nullifier to prevent reuse
     * @param expiresAt Proof expiration timestamp
     */
    function upgradeTier(
        address user,
        Tier newTier,
        bytes32 nullifier,
        uint256 expiresAt
    ) external onlyRole(VERIFIER_ROLE) whenNotPaused {
        if (newTier == Tier.NONE) revert InvalidTier();
        if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed();
        if (expiresAt <= block.timestamp) revert ProofExpired();

        usedNullifiers[nullifier] = true;

        Identity storage id = identities[user];
        Tier oldTier = id.tier;

        id.tier = newTier;
        id.proofTimestamp = block.timestamp;
        id.nullifier = nullifier;
        id.expiresAt = expiresAt;

        emit TierUpgraded(user, oldTier, newTier, nullifier);
    }

    /**
     * @notice Revoke a user's tier (admin action or proof expired).
     */
    function revokeTier(address user) external onlyRole(VERIFIER_ROLE) {
        Identity storage id = identities[user];
        Tier oldTier = id.tier;
        id.tier = Tier.NONE;
        id.expiresAt = 0;
        emit TierRevoked(user, oldTier);
    }

    /**
     * @notice Record a spend and enforce daily limit.
     * @dev Called by SpendingPolicy or ExecutionRouter before executing transfers.
     */
    function recordSpend(address user, uint256 amount) external onlyRole(VERIFIER_ROLE) whenNotPaused {
        Identity storage id = identities[user];

        // Check if proof has expired -> downgrade to NONE
        if (id.tier != Tier.NONE && id.expiresAt <= block.timestamp) {
            Tier old = id.tier;
            id.tier = Tier.NONE;
            emit TierRevoked(user, old);
        }

        // Reset daily counter if 24h passed
        if (block.timestamp - id.lastSpendReset >= 1 days) {
            id.dailySpent = 0;
            id.lastSpendReset = block.timestamp;
        }

        uint256 limit = tierLimits[id.tier];
        uint256 remaining = limit > id.dailySpent ? limit - id.dailySpent : 0;

        if (amount > remaining) {
            revert SpendingLimitExceeded(amount, remaining);
        }

        id.dailySpent += amount;
        emit SpendRecorded(user, amount, id.dailySpent);
    }

    /**
     * @notice Check if a user can spend a given amount.
     */
    function canSpend(address user, uint256 amount) external view returns (bool, uint256 remaining) {
        Identity storage id = identities[user];
        Tier effectiveTier = id.tier;

        if (effectiveTier != Tier.NONE && id.expiresAt <= block.timestamp) {
            effectiveTier = Tier.NONE;
        }

        uint256 limit = tierLimits[effectiveTier];
        uint256 spent = id.dailySpent;

        if (block.timestamp - id.lastSpendReset >= 1 days) {
            spent = 0;
        }

        remaining = limit > spent ? limit - spent : 0;
        return (amount <= remaining, remaining);
    }

    function getUserTier(address user) external view returns (Tier) {
        Identity storage id = identities[user];
        if (id.tier != Tier.NONE && id.expiresAt <= block.timestamp) {
            return Tier.NONE;
        }
        return id.tier;
    }

    function setTierLimit(Tier tier, uint256 limit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        tierLimits[tier] = limit;
        emit TierLimitUpdated(tier, limit);
    }

    function _authorizeUpgrade(address newImpl) internal override onlyRole(UPGRADER_ROLE) {}
}
