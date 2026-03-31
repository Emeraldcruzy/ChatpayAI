// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./SpendingPolicy.sol";
import "./MNTGasReserve.sol";

/**
 * @title ExecutionRouter
 * @notice Central execution hub: routes all payments through policy checks,
 *         gas deduction, and mUSD transfer. Single entry point for the AI agent.
 */
contract ExecutionRouter is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    IERC20 public mUSD;
    SpendingPolicy public policy;
    MNTGasReserve public gasReserve;

    struct Execution {
        address sender;
        address recipient;
        uint256 amount;
        uint256 timestamp;
        bytes32 nonce;
        bool success;
        string txType;  // "transfer", "schedule", "subscription"
    }

    uint256 public executionCount;
    mapping(uint256 => Execution) public executions;
    mapping(address => uint256[]) public userExecutions;

    // Signature verification for Telegram-initiated transactions
    mapping(address => uint256) public nonces;

    event PaymentExecuted(
        uint256 indexed executionId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        string txType
    );
    event ExecutionFailed(uint256 indexed executionId, string reason);

    error InvalidSignature();
    error ExecutionReverted(string reason);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address admin,
        address _mUSD,
        address _policy,
        address _gasReserve
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);

        mUSD = IERC20(_mUSD);
        policy = SpendingPolicy(_policy);
        gasReserve = MNTGasReserve(payable(_gasReserve));
    }

    /**
     * @notice Execute a one-time mUSD transfer.
     * @dev Called by the AI agent backend after intent parsing.
     *
     * Flow:
     * 1. Generate unique nonce
     * 2. Check spending policy (ZK tier, rate limit, global limit)
     * 3. Deduct MNT gas from user's reserve
     * 4. Execute mUSD transfer
     * 5. Log execution
     */
    function executeTransfer(
        address sender,
        address recipient,
        uint256 amount
    ) external onlyRole(AGENT_ROLE) nonReentrant whenNotPaused returns (uint256 executionId) {
        executionId = executionCount++;
        bytes32 nonce = keccak256(abi.encodePacked(sender, executionId, block.timestamp));

        // 1. Policy check (handles ZK tier, rate limiting, replay)
        try policy.checkPolicy(sender, amount, recipient, nonce) {
            // Policy approved
        } catch Error(string memory reason) {
            executions[executionId] = Execution({
                sender: sender,
                recipient: recipient,
                amount: amount,
                timestamp: block.timestamp,
                nonce: nonce,
                success: false,
                txType: "transfer"
            });
            emit ExecutionFailed(executionId, reason);
            revert ExecutionReverted(reason);
        }

        // 2. Deduct MNT gas
        gasReserve.deductGas(sender);

        // 3. Execute mUSD transfer
        require(mUSD.transferFrom(sender, recipient, amount), "mUSD transfer failed");

        // 4. Log
        executions[executionId] = Execution({
            sender: sender,
            recipient: recipient,
            amount: amount,
            timestamp: block.timestamp,
            nonce: nonce,
            success: true,
            txType: "transfer"
        });
        userExecutions[sender].push(executionId);

        emit PaymentExecuted(executionId, sender, recipient, amount, "transfer");
    }

    /**
     * @notice Batch execute multiple transfers (for scheduled payments).
     */
    function batchExecute(
        address[] calldata senders,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyRole(AGENT_ROLE) nonReentrant whenNotPaused {
        require(senders.length == recipients.length && senders.length == amounts.length, "Length mismatch");

        for (uint256 i = 0; i < senders.length; i++) {
            try this.executeTransfer(senders[i], recipients[i], amounts[i]) {
                // success
            } catch {
                // Log failure but continue batch
                emit ExecutionFailed(executionCount, "Batch item failed");
            }
        }
    }

    /**
     * @notice Get a user's execution history.
     */
    function getUserExecutions(address user) external view returns (uint256[] memory) {
        return userExecutions[user];
    }

    function getUserNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
