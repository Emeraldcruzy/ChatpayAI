// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title PaymentScheduler
 * @notice Manages recurring mUSD payments on Mantle.
 *         Supports monthly, weekly, daily, and custom intervals.
 *         Automation bots call executeSchedule() when payments are due.
 */
contract PaymentScheduler is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    IERC20 public mUSD;

    enum Frequency { DAILY, WEEKLY, BIWEEKLY, MONTHLY, CUSTOM }

    struct Schedule {
        address sender;
        address recipient;
        uint256 amount;           // mUSD amount (18 decimals)
        Frequency frequency;
        uint256 customInterval;   // seconds (only for CUSTOM)
        uint256 nextExecution;    // next execution timestamp
        uint256 totalExecutions;  // how many times executed
        uint256 maxExecutions;    // 0 = unlimited
        bool active;
        string description;       // "Netflix", "Rent", etc.
    }

    uint256 public nextScheduleId;
    mapping(uint256 => Schedule) public schedules;
    mapping(address => uint256[]) public userSchedules;

    // Execution fee in MNT (paid to executor bot)
    uint256 public executionFee;

    event ScheduleCreated(
        uint256 indexed scheduleId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        Frequency frequency,
        string description
    );
    event ScheduleExecuted(uint256 indexed scheduleId, uint256 amount, uint256 executionNumber);
    event ScheduleCancelled(uint256 indexed scheduleId);
    event SchedulePaused(uint256 indexed scheduleId);
    event ScheduleResumed(uint256 indexed scheduleId);

    error ScheduleNotActive();
    error NotScheduleOwner();
    error NotYetDue();
    error TransferFailed();
    error InvalidSchedule();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin, address _mUSD) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(EXECUTOR_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);

        mUSD = IERC20(_mUSD);
        executionFee = 0.001 ether; // 0.001 MNT per execution
    }

    /**
     * @notice Create a new recurring payment schedule.
     */
    function createSchedule(
        address recipient,
        uint256 amount,
        Frequency frequency,
        uint256 customInterval,
        uint256 startTime,
        uint256 maxExecutions,
        string calldata description
    ) external whenNotPaused returns (uint256 scheduleId) {
        if (amount == 0 || recipient == address(0)) revert InvalidSchedule();
        if (frequency == Frequency.CUSTOM && customInterval < 1 hours) revert InvalidSchedule();

        scheduleId = nextScheduleId++;

        uint256 interval = _getInterval(frequency, customInterval);
        uint256 firstExec = startTime > block.timestamp ? startTime : block.timestamp + interval;

        schedules[scheduleId] = Schedule({
            sender: msg.sender,
            recipient: recipient,
            amount: amount,
            frequency: frequency,
            customInterval: customInterval,
            nextExecution: firstExec,
            totalExecutions: 0,
            maxExecutions: maxExecutions,
            active: true,
            description: description
        });

        userSchedules[msg.sender].push(scheduleId);

        emit ScheduleCreated(scheduleId, msg.sender, recipient, amount, frequency, description);
    }

    /**
     * @notice Execute a due payment. Called by automation bots.
     * @dev Requires sender to have approved this contract for mUSD.
     */
    function executeSchedule(uint256 scheduleId) external onlyRole(EXECUTOR_ROLE) nonReentrant whenNotPaused {
        Schedule storage sched = schedules[scheduleId];

        if (!sched.active) revert ScheduleNotActive();
        if (block.timestamp < sched.nextExecution) revert NotYetDue();

        // Check if max executions reached
        if (sched.maxExecutions > 0 && sched.totalExecutions >= sched.maxExecutions) {
            sched.active = false;
            emit ScheduleCancelled(scheduleId);
            return;
        }

        // Execute transfer
        bool success = mUSD.transferFrom(sched.sender, sched.recipient, sched.amount);
        if (!success) revert TransferFailed();

        sched.totalExecutions++;
        uint256 interval = _getInterval(sched.frequency, sched.customInterval);
        sched.nextExecution = block.timestamp + interval;

        emit ScheduleExecuted(scheduleId, sched.amount, sched.totalExecutions);
    }

    /**
     * @notice Cancel a schedule (only owner).
     */
    function cancelSchedule(uint256 scheduleId) external {
        Schedule storage sched = schedules[scheduleId];
        if (sched.sender != msg.sender) revert NotScheduleOwner();
        sched.active = false;
        emit ScheduleCancelled(scheduleId);
    }

    /**
     * @notice Pause a schedule temporarily.
     */
    function pauseSchedule(uint256 scheduleId) external {
        Schedule storage sched = schedules[scheduleId];
        if (sched.sender != msg.sender) revert NotScheduleOwner();
        sched.active = false;
        emit SchedulePaused(scheduleId);
    }

    /**
     * @notice Resume a paused schedule.
     */
    function resumeSchedule(uint256 scheduleId) external {
        Schedule storage sched = schedules[scheduleId];
        if (sched.sender != msg.sender) revert NotScheduleOwner();
        sched.active = true;
        uint256 interval = _getInterval(sched.frequency, sched.customInterval);
        sched.nextExecution = block.timestamp + interval;
        emit ScheduleResumed(scheduleId);
    }

    /**
     * @notice Get all due schedules (for off-chain automation bots).
     */
    function getDueSchedules(uint256 from, uint256 to) external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = from; i < to && i < nextScheduleId; i++) {
            if (schedules[i].active && schedules[i].nextExecution <= block.timestamp) {
                count++;
            }
        }

        uint256[] memory due = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = from; i < to && i < nextScheduleId; i++) {
            if (schedules[i].active && schedules[i].nextExecution <= block.timestamp) {
                due[idx++] = i;
            }
        }
        return due;
    }

    function getUserSchedules(address user) external view returns (uint256[] memory) {
        return userSchedules[user];
    }

    function _getInterval(Frequency freq, uint256 custom) internal pure returns (uint256) {
        if (freq == Frequency.DAILY) return 1 days;
        if (freq == Frequency.WEEKLY) return 7 days;
        if (freq == Frequency.BIWEEKLY) return 14 days;
        if (freq == Frequency.MONTHLY) return 30 days;
        return custom;
    }

    function setExecutionFee(uint256 fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        executionFee = fee;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
