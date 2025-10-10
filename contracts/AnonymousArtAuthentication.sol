// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AnonymousArtAuthentication is SepoliaConfig {
    // Structure for encrypted artwork attributes
    struct EncryptedArtwork {
        uint256 id;
        euint32 encryptedCreationYear;  // Artwork creation year
        euint32 encryptedMaterialCode;  // Material classification
        euint32 encryptedStyleCode;     // Artistic style classification
        euint32 encryptedProvenance;    // Ownership history
        uint256 timestamp;
        address submitter;
    }
    
    // Structure for decrypted artwork attributes
    struct DecryptedArtwork {
        uint256 creationYear;
        uint256 materialCode;
        uint256 styleCode;
        uint256 provenance;
        bool isRevealed;
    }

    // Contract state variables
    uint256 public artworkCount;
    mapping(uint256 => EncryptedArtwork) public encryptedArtworks;
    mapping(uint256 => DecryptedArtwork) public decryptedArtworks;
    
    // Mapping for authorized authenticators
    mapping(address => bool) public isAuthenticator;
    
    // Events
    event ArtworkSubmitted(uint256 indexed id, address indexed submitter);
    event AuthenticationRequested(uint256 indexed id, address indexed authenticator);
    event ArtworkAuthenticated(uint256 indexed id);
    event AuthenticatorAdded(address indexed authenticator);
    event AuthenticatorRemoved(address indexed authenticator);

    // Ensures caller is contract owner
    modifier onlyOwner() {
        require(msg.sender == owner, "Unauthorized");
        _;
    }

    // Ensures caller is authorized authenticator
    modifier onlyAuthenticator() {
        require(isAuthenticator[msg.sender], "Unauthorized");
        _;
    }

    address public owner;

    constructor() {
        owner = msg.sender;
        isAuthenticator[msg.sender] = true;
    }

    /// @notice Add new authentication authority
    function addAuthenticator(address _authenticator) external onlyOwner {
        isAuthenticator[_authenticator] = true;
        emit AuthenticatorAdded(_authenticator);
    }

    /// @notice Remove authentication authority
    function removeAuthenticator(address _authenticator) external onlyOwner {
        isAuthenticator[_authenticator] = false;
        emit AuthenticatorRemoved(_authenticator);
    }

    /// @notice Submit encrypted artwork attributes
    function submitEncryptedArtwork(
        euint32 _creationYear,
        euint32 _materialCode,
        euint32 _styleCode,
        euint32 _provenance
    ) external {
        artworkCount += 1;
        uint256 newId = artworkCount;
        
        encryptedArtworks[newId] = EncryptedArtwork({
            id: newId,
            encryptedCreationYear: _creationYear,
            encryptedMaterialCode: _materialCode,
            encryptedStyleCode: _styleCode,
            encryptedProvenance: _provenance,
            timestamp: block.timestamp,
            submitter: msg.sender
        });
        
        decryptedArtworks[newId] = DecryptedArtwork({
            creationYear: 0,
            materialCode: 0,
            styleCode: 0,
            provenance: 0,
            isRevealed: false
        });
        
        emit ArtworkSubmitted(newId, msg.sender);
    }
    
    /// @notice Request artwork authentication
    function requestAuthentication(uint256 _artworkId) external onlyAuthenticator {
        EncryptedArtwork storage artwork = encryptedArtworks[_artworkId];
        require(!decryptedArtworks[_artworkId].isRevealed, "Already authenticated");
        
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(artwork.encryptedCreationYear);
        ciphertexts[1] = FHE.toBytes32(artwork.encryptedMaterialCode);
        ciphertexts[2] = FHE.toBytes32(artwork.encryptedStyleCode);
        ciphertexts[3] = FHE.toBytes32(artwork.encryptedProvenance);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.authenticateArtwork.selector);
        requestToArtworkId[reqId] = _artworkId;
        
        emit AuthenticationRequested(_artworkId, msg.sender);
    }
    
    /// @notice Process authentication results
    function authenticateArtwork(
        uint256 _requestId,
        bytes memory _cleartexts,
        bytes memory _proof
    ) external {
        uint256 artworkId = requestToArtworkId[_requestId];
        require(artworkId != 0, "Invalid request");
        
        EncryptedArtwork storage eArtwork = encryptedArtworks[artworkId];
        DecryptedArtwork storage dArtwork = decryptedArtworks[artworkId];
        require(!dArtwork.isRevealed, "Already authenticated");
        
        FHE.checkSignatures(_requestId, _cleartexts, _proof);
        
        uint256[] memory attributes = abi.decode(_cleartexts, (uint256[]));
        
        dArtwork.creationYear = attributes[0];
        dArtwork.materialCode = attributes[1];
        dArtwork.styleCode = attributes[2];
        dArtwork.provenance = attributes[3];
        dArtwork.isRevealed = true;
        
        emit ArtworkAuthenticated(artworkId);
    }
    
    /// @notice Get authentication status
    function getAuthenticationStatus(uint256 _artworkId) external view returns (
        bool isRevealed,
        uint256 creationYear,
        uint256 materialCode,
        uint256 styleCode,
        uint256 provenance
    ) {
        DecryptedArtwork storage a = decryptedArtworks[_artworkId];
        return (a.isRevealed, a.creationYear, a.materialCode, a.styleCode, a.provenance);
    }

    // Internal tracking of decryption requests
    mapping(uint256 => uint256) private requestToArtworkId;
}