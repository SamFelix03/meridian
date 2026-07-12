# Meridian DevNet transaction log

Run ID: `2026-07-12T08-03-26-998Z`  
Started: 2026-07-12T08:03:26.998Z  
Finished: 2026-07-12T08:04:14.937Z  
Explorer: [https://lighthouse.devnet.cantonloop.com](https://lighthouse.devnet.cantonloop.com)

| # | Step | Update ID | Explorer |
|---|------|-----------|----------|
| 1 | Propose invoice | `1220dc0cc03c4a…25b84229` | [View](https://lighthouse.devnet.cantonloop.com/transactions/1220dc0cc03c4a6ee097d5cdd048fb365a847d018b2723ddad30e967358d25b84229) |
| 2 | Co-sign and issue receivable | `12208282a0d0e8…424f1e6b` | [View](https://lighthouse.devnet.cantonloop.com/transactions/12208282a0d0e85f3d10811d470cedec11e2f94788183d3355cedb457d87424f1e6b) |
| 3 | Post receivable for bid | `1220575287c668…4fe8d4c3` | [View](https://lighthouse.devnet.cantonloop.com/transactions/1220575287c668eef94db6cabc08e7e952ebcee27c50386373db8afc1e584fe8d4c3) |
| 4 | Create financing round factory | `12201e4c850c28…3dcc5339` | [View](https://lighthouse.devnet.cantonloop.com/transactions/12201e4c850c28af3cdbafc825799dec00728db2443c19721301555e192f3dcc5339) |
| 5 | Open sealed-bid financing round | `12209ceb5cf172…5688eaf2` | [View](https://lighthouse.devnet.cantonloop.com/transactions/12209ceb5cf17218a8c77aa4df2fcba29f3bea786a3d89c8783347562b085688eaf2) |
| 6 | Submit sealed bid (Financier A) | `122015e5e134a2…d74492c0` | [View](https://lighthouse.devnet.cantonloop.com/transactions/122015e5e134a24ca0842ddbe483821aca41d737db6c0537bd2487d88ea2d74492c0) |
| 7 | CIP-56 allocate MUSD advance | `122063c53adcc8…b7c5e041` | [View](https://lighthouse.devnet.cantonloop.com/transactions/122063c53adcc834a1353252d97c1c75e361058dbafe6b314f9a41666720b7c5e041) |
| 8 | AwardBid atomic DvP | `122094109e36c5…fbb4dbf1` | [View](https://lighthouse.devnet.cantonloop.com/transactions/122094109e36c5696c62b2cc4755c9f10315d34da234b0c0247522c4a85dfbb4dbf1) |
| 9 | Create syndication factory | `12203a5516737d…a43ebcd0` | [View](https://lighthouse.devnet.cantonloop.com/transactions/12203a5516737d2a50741b5d9662939c7161cb5926b0928c844361ea719da43ebcd0) |
| 10 | Open syndication offering | `1220048aa75686…e96a1f8f` | [View](https://lighthouse.devnet.cantonloop.com/transactions/1220048aa75686f78f3cd26184a8220563a363df9062c842dbc1f90dc4bce96a1f8f) |
| 11 | Submit sealed syndication bid (Financier B) | `1220752c72235c…0921a2b2` | [View](https://lighthouse.devnet.cantonloop.com/transactions/1220752c72235ca083ffed2c129ceedfa0d53296755990d4b89b51e7a8790921a2b2) |
| 12 | Award syndication (participation interest) | `1220493276fa84…e1f3d542` | [View](https://lighthouse.devnet.cantonloop.com/transactions/1220493276fa84d862c82105d20658e8b722f51d08e8b43a110a7fef60ace1f3d542) |
| 13 | CIP-56 waterfall allocation → meridian-financier-b | `12206c008e53ba…15fefc39` | [View](https://lighthouse.devnet.cantonloop.com/transactions/12206c008e53ba4f715939a657fac693ea1b6d317e2d232592e0fcf5598415fefc39) |
| 14 | CIP-56 waterfall allocation → meridian-financier-a | `1220e39209aec2…8f7b4f06` | [View](https://lighthouse.devnet.cantonloop.com/transactions/1220e39209aec219527a6c79b6cccb6d59a8b7e248ff3f8523984433f7d08f7b4f06) |
| 15 | Waterfall RepayWithProof | `1220b852a2748e…e716e97c` | [View](https://lighthouse.devnet.cantonloop.com/transactions/1220b852a2748e345ea8a274a5b6d29d37889edd5655fa5ae5bf71c944cee716e97c) |

## Full update IDs

### 1. Propose invoice

- **Description:** Supplier creates ReceivableProposal with inline assignment consent.
- **Act as:** `meridian-supplier-1`
- **Update ID:** `1220dc0cc03c4a6ee097d5cdd048fb365a847d018b2723ddad30e967358d25b84229`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/1220dc0cc03c4a6ee097d5cdd048fb365a847d018b2723ddad30e967358d25b84229
- **Record time:** 2026-07-12T08:03:29.354298Z
- **Contracts:**
  - proposalCid: `0069068edee7a6bc01041aa5aca6615b410057fd107588ae315d6423affa5452cdca12122010d4d67740ca977d319e0a03d4228ded46b73d36765bcc4b5ef862436db801ba`

### 2. Co-sign and issue receivable

- **Description:** Buyer co-signs proposal → Receivable issued (Issued state).
- **Act as:** `meridian-buyer-1`
- **Update ID:** `12208282a0d0e85f3d10811d470cedec11e2f94788183d3355cedb457d87424f1e6b`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/12208282a0d0e85f3d10811d470cedec11e2f94788183d3355cedb457d87424f1e6b
- **Record time:** 2026-07-12T08:03:31.826167Z
- **Contracts:**
  - receivableCid: `00821cf5418793762ada1057aff43388c0f02dcef6777edde75f22a5e693e2d2f4ca121220034663d63659b48482f19649599a7f8efc5f614934314090a936e997c15391fb`

### 3. Post receivable for bid

- **Description:** Supplier marks receivable PostedForBid.
- **Act as:** `meridian-supplier-1`
- **Update ID:** `1220575287c668eef94db6cabc08e7e952ebcee27c50386373db8afc1e584fe8d4c3`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/1220575287c668eef94db6cabc08e7e952ebcee27c50386373db8afc1e584fe8d4c3
- **Record time:** 2026-07-12T08:03:34.644139Z
- **Contracts:**
  - postedReceivableCid: `003b57a63c2e2cdb8c85385308fe929dacc7777ddb270c05225c5567a113055c54ca121220fd089c37957530159f19cb18ee382c480aaa8ec06df825f7d9d6eac92f255d6f`

### 4. Create financing round factory

- **Description:** Supplier creates FinancingRoundFactory.
- **Act as:** `meridian-supplier-1`
- **Update ID:** `12201e4c850c28af3cdbafc825799dec00728db2443c19721301555e192f3dcc5339`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/12201e4c850c28af3cdbafc825799dec00728db2443c19721301555e192f3dcc5339
- **Record time:** 2026-07-12T08:03:37.229962Z
- **Contracts:**
  - financingFactoryCid: `00cba9e8d140cd02a3850198ce9177441ca9c1e4d81649d43d8170aaa7012c96c1ca1212206e5d036c81224171fc33a67bb76e333b644b70c1f654d6180576197ea5e99785`

### 5. Open sealed-bid financing round

- **Description:** Supplier opens FinancingRequest inviting Financier A (oracle-anchored band).
- **Act as:** `meridian-supplier-1`
- **Update ID:** `12209ceb5cf17218a8c77aa4df2fcba29f3bea786a3d89c8783347562b085688eaf2`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/12209ceb5cf17218a8c77aa4df2fcba29f3bea786a3d89c8783347562b085688eaf2
- **Record time:** 2026-07-12T08:03:39.691477Z
- **Contracts:**
  - financingRequestCid: `00120b4163814c6de6c49066e2cc0694500462ed822b3f2625fa16391a3e74da5aca1212200699f967a347bfab23b2b06fae5f9c8c5c8456f046abd703401f0d592e51b25b`

### 6. Submit sealed bid (Financier A)

- **Description:** Financier A submits oracle-anchored Bid (supplier-only observer).
- **Act as:** `meridian-financier-a`
- **Update ID:** `122015e5e134a24ca0842ddbe483821aca41d737db6c0537bd2487d88ea2d74492c0`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/122015e5e134a24ca0842ddbe483821aca41d737db6c0537bd2487d88ea2d74492c0
- **Record time:** 2026-07-12T08:03:43.402099Z
- **Contracts:**
  - bidCid: `00e9720037cf55e177a270d3d46395e903897bfeeb8b1c79439771ea4ad03f9b88ca1212208e89c573473948b066d431ba7c5e6ae50e3110462a7ed98967d36c059415a853`

### 7. CIP-56 allocate MUSD advance

- **Description:** Financier + registry create locked MusdAllocation for the advance amount.
- **Act as:** `meridian-financier-a`, `meridian-registry-1`
- **Update ID:** `122063c53adcc834a1353252d97c1c75e361058dbafe6b314f9a41666720b7c5e041`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/122063c53adcc834a1353252d97c1c75e361058dbafe6b314f9a41666720b7c5e041
- **Record time:** 2026-07-12T08:03:47.276273Z
- **Contracts:**
  - allocationCid: `0061eef9d5fdd743e53f82fd228d9cf2127770f54a6a9d73f2b6225caf2ca7e5a5ca121220f563b8da80722af1a2c42f49534a91e03b56ecb37ee6c5292dd3437eacf442fe`

### 8. AwardBid atomic DvP

- **Description:** Supplier + financier: execute allocation, ApplyFunding, close bids, write SettlementAuditRecord.
- **Act as:** `meridian-supplier-1`, `meridian-financier-a`
- **Update ID:** `122094109e36c5696c62b2cc4755c9f10315d34da234b0c0247522c4a85dfbb4dbf1`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/122094109e36c5696c62b2cc4755c9f10315d34da234b0c0247522c4a85dfbb4dbf1
- **Record time:** 2026-07-12T08:03:49.839291Z
- **Contracts:**
  - fundedReceivableCid: `0050c5af3ea995a28a0dfb18ed455aa8b9c0cb70f890319264dd03dd2535c9d417ca12122074a4b040241417ff33cc76cf820ffaf37c2c6bc9edfa9cdc3871344b15a36058`
  - bidCid: `00e9720037cf55e177a270d3d46395e903897bfeeb8b1c79439771ea4ad03f9b88ca1212208e89c573473948b066d431ba7c5e6ae50e3110462a7ed98967d36c059415a853`
  - financingRequestCid: `00b421a96244d5721fa3d7921f8ac4849ca4f5a96d32115ef0eaf5eaca8993ea03ca121220c49fb8d41bb34b6b9f8bd15fd1e07e696f6676e13d8f12a289fb4d0945ac1538`

### 9. Create syndication factory

- **Description:** Lead financier creates SyndicationFactory.
- **Act as:** `meridian-financier-a`
- **Update ID:** `12203a5516737d2a50741b5d9662939c7161cb5926b0928c844361ea719da43ebcd0`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/12203a5516737d2a50741b5d9662939c7161cb5926b0928c844361ea719da43ebcd0
- **Record time:** 2026-07-12T08:03:52.360988Z
- **Contracts:**
  - syndicationFactoryCid: `00f40ef8063dbfb6be29234cf9cfb505e9508e0e7b53cbaf10dc8d0a53b77040acca121220b8841350a9ae3552522fec1a7ca76968557f3c3eada8143b333eb15a58ff237d`

### 10. Open syndication offering

- **Description:** Lead opens SyndicationOffering inviting Financier B (buyer/supplier never observers).
- **Act as:** `meridian-financier-a`
- **Update ID:** `1220048aa75686f78f3cd26184a8220563a363df9062c842dbc1f90dc4bce96a1f8f`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/1220048aa75686f78f3cd26184a8220563a363df9062c842dbc1f90dc4bce96a1f8f
- **Record time:** 2026-07-12T08:03:54.832889Z
- **Contracts:**
  - offeringCid: `008b4518f1713e955216ad3cba5fcc528f80595032f4a470c91a434ab3223acf5aca1212200f93b37341e2fc8283bb6fafd3c8395598828e64f6faae72a881b6e093f5f621`

### 11. Submit sealed syndication bid (Financier B)

- **Description:** Participant submits SyndicationBid (lead-only observer).
- **Act as:** `meridian-financier-b`
- **Update ID:** `1220752c72235ca083ffed2c129ceedfa0d53296755990d4b89b51e7a8790921a2b2`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/1220752c72235ca083ffed2c129ceedfa0d53296755990d4b89b51e7a8790921a2b2
- **Record time:** 2026-07-12T08:03:57.862071Z
- **Contracts:**
  - syndicationBidCid: `003472560f3867fdbdbcd22f637f7a3f2734ed2e0ac0b91b619619a8d935fa9c40ca1212203210c3d039a74351e05d61800669d2fde92e2601fdc226f29980d6c83f965790`

### 12. Award syndication (participation interest)

- **Description:** Lead + participant award → ParticipationInterest + PartiallySyndicated receivable.
- **Act as:** `meridian-financier-a`, `meridian-financier-b`
- **Update ID:** `1220493276fa84d862c82105d20658e8b722f51d08e8b43a110a7fef60ace1f3d542`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/1220493276fa84d862c82105d20658e8b722f51d08e8b43a110a7fef60ace1f3d542
- **Record time:** 2026-07-12T08:04:01.683952Z
- **Contracts:**
  - syndicatedReceivableCid: `0096d84128e7e7fbc019e3f8ec34c040f84a918dd1566486871f09e223ac580198ca121220efbb13591d224aa4d72c680e064e34e0cdaeadaa4c676e5d7a0dad82faf6cfc3`
  - participationInterestCid: `007908b0448e793d313e5cb4ff9198717cf085b628ec6962521b927bb549008e6dca121220df8cf6c6ab9d3a2f02d2a992283e1bcf1b9715563bdf889182557add049aa1e0`

### 13. CIP-56 waterfall allocation → meridian-financier-b

- **Description:** Buyer allocates 800 MUSD to meridian-financier-b for syndicated repayment waterfall.
- **Act as:** `meridian-buyer-1`, `meridian-registry-1`
- **Update ID:** `12206c008e53ba4f715939a657fac693ea1b6d317e2d232592e0fcf5598415fefc39`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/12206c008e53ba4f715939a657fac693ea1b6d317e2d232592e0fcf5598415fefc39
- **Record time:** 2026-07-12T08:04:05.668306Z
- **Contracts:**
  - allocationCid: `00ac0dfd9a804028c7497f0c57d1eef80a2585a0c4ebd5b9be702c4e68282ff4a5ca121220da0a7b22e70b50802aaa35da079ad4d28351e90b1cf0d83eb57792cc8a21612b`
  - receiver: `meridian-financier-b::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8`
  - amount: `800`

### 14. CIP-56 waterfall allocation → meridian-financier-a

- **Description:** Buyer allocates 1200 MUSD to meridian-financier-a for syndicated repayment waterfall.
- **Act as:** `meridian-buyer-1`, `meridian-registry-1`
- **Update ID:** `1220e39209aec219527a6c79b6cccb6d59a8b7e248ff3f8523984433f7d08f7b4f06`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/1220e39209aec219527a6c79b6cccb6d59a8b7e248ff3f8523984433f7d08f7b4f06
- **Record time:** 2026-07-12T08:04:08.527983Z
- **Contracts:**
  - allocationCid: `0030e78c1fccbbf1816096a8991e4b7c3b785612bf243e1378119d165481355c10ca121220130a4a4e79270e6613e30b5f0e595bf4ed944ab9c46ea0ec19dde9379515d217`
  - receiver: `meridian-financier-a::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8`
  - amount: `1200`

### 15. Waterfall RepayWithProof

- **Description:** Buyer + lead + supplier + participant: execute repayment allocations and create RepaymentProof.
- **Act as:** `meridian-buyer-1`, `meridian-financier-a`, `meridian-supplier-1`, `meridian-financier-b`
- **Update ID:** `1220b852a2748e345ea8a274a5b6d29d37889edd5655fa5ae5bf71c944cee716e97c`
- **Explorer:** https://lighthouse.devnet.cantonloop.com/transactions/1220b852a2748e345ea8a274a5b6d29d37889edd5655fa5ae5bf71c944cee716e97c
- **Record time:** 2026-07-12T08:04:11.498606Z
- **Contracts:**
  - repaidReceivableCid: `0012b1af725d9dc160b1af013d2e859a0a0a8d78635c1fb56f42df64819ecc29faca121220552754bd74f6fbe34a8c84c245481530fffecfca5991077f118d96697434597e`
  - repaymentProofCid: `00710c827c1bec19409e5bdf2f19562ef3ac83d7d63e47da5f9d4f04e9cb10e66bca12122029753f76decd7e0e23a37dbf152797ad9ed73fa19932dd5da35f247e1cf46df2`
