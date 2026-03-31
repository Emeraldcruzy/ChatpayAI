// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title MNTGasReserve
 * @notice Manages MNT gas reserves for autonomous payment execution.
 *         Users deposit MNT, the system draws gas fees for each scheduled execution.
 *         Includes auto-refill alerts and minimum reserve enforcement.
 */
contract MNTGasReserve is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    struct Reserve {
        uint256 balance;          // MNT deposited
        uint256 totalGasUsed;     // lifetime gas consumed
        uint256 minBalance;       // user-set minimum (alerts below this)
        uint256 lastDeduction;    // timestamp of last gas deduction
    }

    mapping(address => Reserve) public reserves;

    uint256 public baseFeePerExecution;   // base MNT fee per automated execution
    uint256 public minDepositAmount;       // minimum deposit
    uint256 public globalReserve;          // total MNT held

    // Staking bonus: users who maintain reserves get reduced fees
    uint256 public stakingThreshold;       // MNT balance for discount
    uint256 public stakingDiscount;        // basis points (e.g., 2000 = 20%)

    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event GasDeducted(address indexed user, uint256 amount, uint256 remaining);
    event LowBalance(address indexed user, uint256 balance, uint256 minimum);
    event MinBalanceSet(address indexed user, uint256 minimum);

    error InsufficientGasReserve(uint256 required, uint256 available);
    error BelowMinDeposit();
    error WithdrawExceedsBalance();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(EXECUTOR_ROLE, admin);

        baseFeePerExecution = 0.002 ether;  // 0.002 MNT
        minDepositAmount = 0.01 ether;       // 0.01 MNT minimum
        stakingThreshold = 10 ether;         // 10 MNT for staking discount
        stakingDiscount = 2000;              // 20% discount
    }

    /**
     * @notice Deposit MNT into gas reserve.
     */
    function deposit() external payable {
        if (msg.value < minDepositAmount) revert BelowMinDeposit();

        reserves[msg.sender].balance += msg.value;
        globalReserve += msg.value;

        emit Deposited(msg.sender, msg.value, reserves[msg.sender].balance);
    }

    /**
     * @notice Withdraw MNT from gas reserve.
     */
    function withdraw(uint256 amount) external nonReentrant {
        Reserve storage res = reserves[msg.sender];
        if (amount > res.balance) revert WithdrawExceedsBalance();

        res.balance -= amount;
        globalReserve -= amount;

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "MNT transfer failed");

        emit Withdrawn(msg.sender, amount, res.balance);
    }

    /**
     * @notice Deduct gas fee for an automated execution.
     * @dev Called by ExecutionRouter during scheduled payment execution.
     */
    function deductGas(address user) external onlyRole(EXECUTOR_ROLE) returns (uint256 fee) {
        fee = getEffectiveFee(user);
        Reserve storage res = reserves[user];

        if (res.balance < fee) {
            revert InsufficientGasReserve(fee, res.balance);
        }

        res.balance -= fee;
        res.totalGasUsed += fee;
        res.lastDeduction = block.timestamp;
        globalReserve -= fee;

        // Check if below user's minimum threshold
        if (res.balance < res.minBalance) {
            emit LowBalance(user, res.balance, res.minBalance);
        }

        emit GasDeducted(user, fee, res.balance);
    }

    /**
     * @notice Get effective fee considering staking discount.
     */
    function getEffectiveFee(address user) public view returns (uint256) {
        if (reserves[user].balance >= stakingThreshold) {
            return baseFeePerExecution * (10000 - stakingDiscount) / 10000;
        }
        return baseFeePerExecution;
    }

    /**
     * @notice Estimate MNT needed for N future executions.
     */
    function estimateGasNeeded(address user, uint256 executions) external view returns (uint256) {
        uint256 fee = getEffectiveFee(user);
        return fee * executions;
    }

    /**
     * @notice Check if user has enough gas for N executions.
     */
    function hasEnoughGas(address user, uint256 executions) external view returns (bool, uint256 deficit) {
        uint256 needed = this.estimateGasNeeded(user, executions);
        uint256 balance = reserves[user].balance;
        if (balance >= needed) return (true, 0);
        return (false, needed - balance);
    }

    /**
     * @notice User sets their minimum balance alert threshold.
     */
    function setMinBalance(uint256 minimum) external {
        reserves[msg.sender].minBalance = minimum;
        emit MinBalanceSet(msg.sender, minimum);
    }

    function setBaseFee(uint256 fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseFeePerExecution = fee;
    }

    function setStakingParams(uint256 threshold, uint256 discount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stakingThreshold = threshold;
        stakingDiscount = discount;
    }

    receive() external payable {
        reserves[msg.sender].balance += msg.value;
        globalReserve += msg.value;
        emit Deposited(msg.sender, msg.value, reserves[msg.sender].balance);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
