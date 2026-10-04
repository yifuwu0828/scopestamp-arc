// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Immutable scope metadata only. This contract never receives payments.
contract ScopeStamp {
    struct Invoice {
        address issuer;
        address recipient;
        uint256 amount;
        bytes32 scopeHash;
        bytes32 nonceHash;
        uint64 anchoredAt;
    }
    mapping(bytes32 => Invoice) public invoices;
    event Anchored(bytes32 indexed id, address indexed issuer, address indexed recipient,
        uint256 amount, bytes32 scopeHash, bytes32 nonceHash);

    function anchor(address recipient, uint256 amount, bytes32 scopeHash,
        bytes32 nonceHash) external returns (bytes32 id) {
        require(recipient != address(0), "zero recipient");
        require(msg.sender == recipient, "recipient must anchor");
        require(recipient.code.length == 0, "EOA recipient only");
        require(amount > 0, "zero amount");
        require(scopeHash != bytes32(0) && nonceHash != bytes32(0), "zero hash");
        id = keccak256(abi.encode(recipient, amount, scopeHash, nonceHash));
        require(invoices[id].issuer == address(0), "already anchored");
        invoices[id] = Invoice(msg.sender, recipient, amount, scopeHash, nonceHash,
            uint64(block.timestamp));
        emit Anchored(id, msg.sender, recipient, amount, scopeHash, nonceHash);
    }
}
