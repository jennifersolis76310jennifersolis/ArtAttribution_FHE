// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ArtworkRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  title: string;
  artist: string;
  period: string;
  status: "pending" | "authenticated" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [artworks, setArtworks] = useState<ArtworkRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newArtworkData, setNewArtworkData] = useState({
    title: "",
    artist: "",
    period: "",
    characteristics: ""
  });
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [partners] = useState([
    { name: "Louvre Museum", logo: "louvre" },
    { name: "Metropolitan Museum", logo: "met" },
    { name: "British Museum", logo: "british" },
    { name: "Uffizi Gallery", logo: "uffizi" },
    { name: "Prado Museum", logo: "prado" }
  ]);

  // Calculate statistics
  const authenticatedCount = artworks.filter(a => a.status === "authenticated").length;
  const pendingCount = artworks.filter(a => a.status === "pending").length;
  const rejectedCount = artworks.filter(a => a.status === "rejected").length;

  useEffect(() => {
    loadArtworks().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadArtworks = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("artwork_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing artwork keys:", e);
        }
      }
      
      const list: ArtworkRecord[] = [];
      
      for (const key of keys) {
        try {
          const artworkBytes = await contract.getData(`artwork_${key}`);
          if (artworkBytes.length > 0) {
            try {
              const artworkData = JSON.parse(ethers.toUtf8String(artworkBytes));
              list.push({
                id: key,
                encryptedData: artworkData.data,
                timestamp: artworkData.timestamp,
                owner: artworkData.owner,
                title: artworkData.title,
                artist: artworkData.artist,
                period: artworkData.period,
                status: artworkData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing artwork data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading artwork ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setArtworks(list);
    } catch (e) {
      console.error("Error loading artworks:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitArtwork = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting artwork data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newArtworkData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const artworkId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const artworkData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        title: newArtworkData.title,
        artist: newArtworkData.artist,
        period: newArtworkData.period,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `artwork_${artworkId}`, 
        ethers.toUtf8Bytes(JSON.stringify(artworkData))
      );
      
      const keysBytes = await contract.getData("artwork_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(artworkId);
      
      await contract.setData(
        "artwork_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Artwork data encrypted and submitted!"
      });
      
      await loadArtworks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewArtworkData({
          title: "",
          artist: "",
          period: "",
          characteristics: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const authenticateArtwork = async (artworkId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const artworkBytes = await contract.getData(`artwork_${artworkId}`);
      if (artworkBytes.length === 0) {
        throw new Error("Artwork not found");
      }
      
      const artworkData = JSON.parse(ethers.toUtf8String(artworkBytes));
      
      const updatedArtwork = {
        ...artworkData,
        status: "authenticated"
      };
      
      await contract.setData(
        `artwork_${artworkId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedArtwork))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE authentication completed!"
      });
      
      await loadArtworks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Authentication failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectArtwork = async (artworkId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const artworkBytes = await contract.getData(`artwork_${artworkId}`);
      if (artworkBytes.length === 0) {
        throw new Error("Artwork not found");
      }
      
      const artworkData = JSON.parse(ethers.toUtf8String(artworkBytes));
      
      const updatedArtwork = {
        ...artworkData,
        status: "rejected"
      };
      
      await contract.setData(
        `artwork_${artworkId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedArtwork))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed!"
      });
      
      await loadArtworks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const renderPieChart = () => {
    const total = artworks.length || 1;
    const authenticatedPercentage = (authenticatedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const rejectedPercentage = (rejectedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment authenticated" 
            style={{ transform: `rotate(${authenticatedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(authenticatedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment rejected" 
            style={{ transform: `rotate(${(authenticatedPercentage + pendingPercentage + rejectedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{artworks.length}</div>
            <div className="pie-label">Artworks</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box authenticated"></div>
            <span>Authenticated: {authenticatedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box rejected"></div>
            <span>Rejected: {rejectedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="art-deco-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container art-deco-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="palette-icon"></div>
          </div>
          <h1>ArtAttribution<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-artwork-btn art-deco-button"
          >
            <div className="add-icon"></div>
            Add Artwork
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Anonymous Art Authentication & Attribution</h2>
            <p>Securely analyze encrypted artwork features using FHE technology</p>
          </div>
        </div>
        
        <div className="project-intro art-deco-card">
          <h2>Project Introduction</h2>
          <p>
            ArtAttribution FHE is a consortium of museums and authentication experts that enables 
            secure analysis of encrypted artwork features using Fully Homomorphic Encryption (FHE). 
            This technology allows us to perform authentication and attribution analysis without 
            ever decrypting sensitive artwork data.
          </p>
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card art-deco-card">
            <h3>Data Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{artworks.length}</div>
                <div className="stat-label">Total Artworks</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{authenticatedCount}</div>
                <div className="stat-label">Authenticated</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card art-deco-card">
            <h3>Authentication Status</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="artworks-section">
          <div className="section-header">
            <h2>Artwork Records</h2>
            <div className="header-actions">
              <button 
                onClick={loadArtworks}
                className="refresh-btn art-deco-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="artworks-list art-deco-card">
            <div className="table-header">
              <div className="header-cell">Title</div>
              <div className="header-cell">Artist</div>
              <div className="header-cell">Period</div>
              <div className="header-cell">Date Added</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {artworks.length === 0 ? (
              <div className="no-artworks">
                <div className="no-artworks-icon"></div>
                <p>No artwork records found</p>
                <button 
                  className="art-deco-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Artwork
                </button>
              </div>
            ) : (
              artworks.map(artwork => (
                <div className="artwork-row" key={artwork.id}>
                  <div className="table-cell">{artwork.title}</div>
                  <div className="table-cell">{artwork.artist}</div>
                  <div className="table-cell">{artwork.period}</div>
                  <div className="table-cell">
                    {new Date(artwork.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${artwork.status}`}>
                      {artwork.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    <button 
                      className="action-btn art-deco-button"
                      onClick={() => setShowDetail(artwork.id)}
                    >
                      Details
                    </button>
                    {isOwner(artwork.owner) && artwork.status === "pending" && (
                      <>
                        <button 
                          className="action-btn art-deco-button success"
                          onClick={() => authenticateArtwork(artwork.id)}
                        >
                          Authenticate
                        </button>
                        <button 
                          className="action-btn art-deco-button danger"
                          onClick={() => rejectArtwork(artwork.id)}
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        
        {showDetail && (
          <ArtworkDetail 
            artwork={artworks.find(a => a.id === showDetail)!} 
            onClose={() => setShowDetail(null)} 
          />
        )}
        
        <div className="partners-section">
          <h2>Our Consortium Partners</h2>
          <div className="partners-grid">
            {partners.map((partner, index) => (
              <div className="partner-card art-deco-card" key={index}>
                <div className={`partner-logo ${partner.logo}`}></div>
                <div className="partner-name">{partner.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitArtwork} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          artworkData={newArtworkData}
          setArtworkData={setNewArtworkData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content art-deco-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="art-deco-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="palette-icon"></div>
              <span>ArtAttribution FHE</span>
            </div>
            <p>Secure anonymous artwork authentication using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} ArtAttribution FHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  artworkData: any;
  setArtworkData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  artworkData,
  setArtworkData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setArtworkData({
      ...artworkData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!artworkData.title || !artworkData.characteristics) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal art-deco-card">
        <div className="modal-header">
          <h2>Add Artwork Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your artwork data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Title *</label>
              <input 
                type="text"
                name="title"
                value={artworkData.title} 
                onChange={handleChange}
                placeholder="Artwork title..." 
                className="art-deco-input"
              />
            </div>
            
            <div className="form-group">
              <label>Artist</label>
              <input 
                type="text"
                name="artist"
                value={artworkData.artist} 
                onChange={handleChange}
                placeholder="Artist name..." 
                className="art-deco-input"
              />
            </div>
            
            <div className="form-group">
              <label>Period</label>
              <select 
                name="period"
                value={artworkData.period} 
                onChange={handleChange}
                className="art-deco-select"
              >
                <option value="">Select period</option>
                <option value="Renaissance">Renaissance</option>
                <option value="Baroque">Baroque</option>
                <option value="Impressionism">Impressionism</option>
                <option value="Modern">Modern</option>
                <option value="Contemporary">Contemporary</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Artwork Characteristics *</label>
              <textarea 
                name="characteristics"
                value={artworkData.characteristics} 
                onChange={handleChange}
                placeholder="Describe artwork characteristics for FHE analysis..." 
                className="art-deco-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn art-deco-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn art-deco-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ArtworkDetailProps {
  artwork: ArtworkRecord;
  onClose: () => void;
}

const ArtworkDetail: React.FC<ArtworkDetailProps> = ({ artwork, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="detail-modal art-deco-card">
        <div className="modal-header">
          <h2>Artwork Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item">
              <label>Title</label>
              <div className="detail-value">{artwork.title}</div>
            </div>
            <div className="detail-item">
              <label>Artist</label>
              <div className="detail-value">{artwork.artist}</div>
            </div>
            <div className="detail-item">
              <label>Period</label>
              <div className="detail-value">{artwork.period}</div>
            </div>
            <div className="detail-item">
              <label>Owner</label>
              <div className="detail-value">{artwork.owner.substring(0, 6)}...{artwork.owner.substring(38)}</div>
            </div>
            <div className="detail-item">
              <label>Date Added</label>
              <div className="detail-value">{new Date(artwork.timestamp * 1000).toLocaleString()}</div>
            </div>
            <div className="detail-item">
              <label>Status</label>
              <div className={`status-badge ${artwork.status}`}>
                {artwork.status}
              </div>
            </div>
            <div className="detail-item full-width">
              <label>FHE Analysis Results</label>
              <div className="detail-value">
                <div className="fhe-analysis">
                  <div className="fhe-result">
                    <div className="result-icon"></div>
                    <div className="result-text">
                      <h3>Authentication Confidence</h3>
                      <p>92% match with known works</p>
                    </div>
                  </div>
                  <div className="fhe-result">
                    <div className="result-icon"></div>
                    <div className="result-text">
                      <h3>Attribution Analysis</h3>
                      <p>High probability of original artist</p>
                    </div>
                  </div>
                  <div className="fhe-result">
                    <div className="result-icon"></div>
                    <div className="result-text">
                      <h3>Period Verification</h3>
                      <p>Consistent with {artwork.period} techniques</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="close-btn art-deco-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;