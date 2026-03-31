// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Treasury
 * @notice Collects protocol fees (in MNT and mUSD), manages protocol reserves,
 *         and distributes rewards to automation operators.
 */
contract Treasury is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");

    IERC20 public mUSD;

    uint256 public protocolFeeBps;  // basis points on each transfer (e.g., 10 = 0.1%)
    uint256 public totalFeesCollectedMUSD;
    uint256 public totalFeesCollectedMNT;

    // Operator rewards pool
    mapping(address => uint256) public operatorRewards;

    event FeeCollected(address indexed from, uint256 amount, string tokenType);
    event RewardDistributed(address indexed operator, uint256 amount);
    event FeeUpdated(uint256 newFeeBps);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin, address _mUSD) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TREASURER_ROLE, admin);

        mUSD = IERC20(_mUSD);
        protocolFeeBps = 10; // 0.1% default
    }

    /**
     * @notice Calculate protocol fee for a given amount.
     */
    function calculateFee(uint256 amount) external view returns (uint256) {
        return (amount * protocolFeeBps) / 10000;
    }

    /**
     * @notice Collect mUSD protocol fee.
     */
    function collectMUSDFee(address from, uint256 amount) external onlyRole(TREASURER_ROLE) {
        require(mUSD.transferFrom(from, address(this), amount), "Fee collection failed");
        totalFeesCollectedMUSD += amount;
        emit FeeCollected(from, amount, "mUSD");
    }

    /**
     * @notice Collect MNT fees (received as native token).
     */
    receive() external payable {
        totalFeesCollectedMNT += msg.value;
        emit FeeCollected(msg.sender, msg.value, "MNT");
    }

    /**
     * @notice Distribute MNT rewards to automation operators.
     */
    function distributeRewards(
        address[] calldata operators,
        uint256[] calldata amounts
    ) external onlyRole(TREASURER_ROLE) nonReentrant {
        require(operators.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < operators.length; i++) {
            operatorRewards[operators[i]] += amounts[i];
            (bool sent, ) = operators[i].call{value: amounts[i]}("");
            require(sent, "Reward transfer failed");
            emit RewardDistributed(operators[i], amounts[i]);
        }
    }

    /**
     * @notice Withdraw accumulated mUSD fees (admin).
     */
    function withdrawMUSD(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(mUSD.transfer(to, amount), "Withdraw failed");
    }

    /**
     * @notice Withdraw accumulated MNT fees (admin).
     */
    function withdrawMNT(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "MNT withdraw failed");
    }

    function setProtocolFee(uint256 feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(feeBps <= 500, "Fee too high"); // max 5%
        protocolFeeBps = feeBps;
        emit FeeUpdated(feeBps);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
