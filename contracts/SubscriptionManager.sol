// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SubscriptionManager
 * @notice Manages subscription services: merchants register plans, users subscribe,
 *         and automation bots execute billing cycles.
 */
contract SubscriptionManager is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant MERCHANT_ROLE = keccak256("MERCHANT_ROLE");

    IERC20 public mUSD;

    struct Plan {
        address merchant;
        uint256 price;           // mUSD per period
        uint256 period;          // billing period in seconds
        string name;             // "Netflix Basic", "Spotify Premium"
        bool active;
    }

    struct Subscription {
        address subscriber;
        uint256 planId;
        uint256 nextBilling;
        uint256 totalPaid;
        bool active;
    }

    uint256 public nextPlanId;
    uint256 public nextSubId;
    mapping(uint256 => Plan) public plans;
    mapping(uint256 => Subscription) public subscriptions;
    mapping(address => uint256[]) public userSubscriptions;
    mapping(address => uint256[]) public merchantPlans;

    event PlanCreated(uint256 indexed planId, address indexed merchant, string name, uint256 price);
    event Subscribed(uint256 indexed subId, address indexed user, uint256 indexed planId);
    event BillingExecuted(uint256 indexed subId, uint256 amount);
    event Unsubscribed(uint256 indexed subId);

    error PlanNotActive();
    error SubNotActive();
    error NotBillingTime();
    error NotSubOwner();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin, address _mUSD) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(EXECUTOR_ROLE, admin);
        _grantRole(MERCHANT_ROLE, admin);

        mUSD = IERC20(_mUSD);
    }

    function createPlan(
        uint256 price,
        uint256 period,
        string calldata name
    ) external onlyRole(MERCHANT_ROLE) returns (uint256 planId) {
        planId = nextPlanId++;
        plans[planId] = Plan({
            merchant: msg.sender,
            price: price,
            period: period,
            name: name,
            active: true
        });
        merchantPlans[msg.sender].push(planId);
        emit PlanCreated(planId, msg.sender, name, price);
    }

    function subscribe(uint256 planId) external returns (uint256 subId) {
        Plan storage plan = plans[planId];
        if (!plan.active) revert PlanNotActive();

        subId = nextSubId++;
        subscriptions[subId] = Subscription({
            subscriber: msg.sender,
            planId: planId,
            nextBilling: block.timestamp,
            totalPaid: 0,
            active: true
        });
        userSubscriptions[msg.sender].push(subId);
        emit Subscribed(subId, msg.sender, planId);
    }

    function executeBilling(uint256 subId) external onlyRole(EXECUTOR_ROLE) nonReentrant {
        Subscription storage sub = subscriptions[subId];
        if (!sub.active) revert SubNotActive();
        if (block.timestamp < sub.nextBilling) revert NotBillingTime();

        Plan storage plan = plans[sub.planId];
        if (!plan.active) {
            sub.active = false;
            emit Unsubscribed(subId);
            return;
        }

        require(mUSD.transferFrom(sub.subscriber, plan.merchant, plan.price), "Transfer failed");

        sub.totalPaid += plan.price;
        sub.nextBilling = block.timestamp + plan.period;

        emit BillingExecuted(subId, plan.price);
    }

    function unsubscribe(uint256 subId) external {
        Subscription storage sub = subscriptions[subId];
        if (sub.subscriber != msg.sender) revert NotSubOwner();
        sub.active = false;
        emit Unsubscribed(subId);
    }

    function getDueBillings(uint256 from, uint256 to) external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = from; i < to && i < nextSubId; i++) {
            if (subscriptions[i].active && subscriptions[i].nextBilling <= block.timestamp) count++;
        }
        uint256[] memory due = new uint256[](count);
        uint256 idx;
        for (uint256 i = from; i < to && i < nextSubId; i++) {
            if (subscriptions[i].active && subscriptions[i].nextBilling <= block.timestamp) {
                due[idx++] = i;
            }
        }
        return due;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
