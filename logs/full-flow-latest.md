# Full Meridian flow log — 2026-07-12T08-03-26-998Z

End-to-end Seaport DevNet run: invoice issuance → sealed-bid financing → CIP-56 DvP award → syndication → waterfall repayment.

| Field | Value |
|-------|-------|
| Started | 2026-07-12T08:03:26.998Z |
| Finished | 2026-07-12T08:04:14.937Z |
| Environment | seaport-devnet |
| Face value | 2000 |
| Advance | 1500 |
| Participant share | 4000 bps |
| Transactions captured | 15 / 15 steps |

## Parties

| Role | Party hint |
|------|------------|
| supplier | `meridian-supplier-1` |
| buyer | `meridian-buyer-1` |
| financierA | `meridian-financier-a` |
| financierB | `meridian-financier-b` |
| platformOperator | `meridian-platform-operator-1` |
| registry | `meridian-registry-1` |

## Steps

### 1. Propose invoice — ok

Supplier creates ReceivableProposal with inline assignment consent.

- **Act as:** `meridian-supplier-1`
- **Update ID:** `1220dc0cc03c4a6ee097d5cdd048fb365a847d018b2723ddad30e967358d25b84229`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/1220dc0cc03c4a6ee097d5cdd048fb365a847d018b2723ddad30e967358d25b84229)
- **Contracts:**
  - **proposalCid:** `0069068edee7a6bc01041aa5aca6615b410057fd107588ae…`

### 2. Co-sign and issue receivable — ok

Buyer co-signs proposal → Receivable issued (Issued state).

- **Act as:** `meridian-buyer-1`
- **Update ID:** `12208282a0d0e85f3d10811d470cedec11e2f94788183d3355cedb457d87424f1e6b`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/12208282a0d0e85f3d10811d470cedec11e2f94788183d3355cedb457d87424f1e6b)
- **Contracts:**
  - **receivableCid:** `00821cf5418793762ada1057aff43388c0f02dcef6777edd…`

### 3. Post receivable for bid — ok

Supplier marks receivable PostedForBid.

- **Act as:** `meridian-supplier-1`
- **Update ID:** `1220575287c668eef94db6cabc08e7e952ebcee27c50386373db8afc1e584fe8d4c3`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/1220575287c668eef94db6cabc08e7e952ebcee27c50386373db8afc1e584fe8d4c3)
- **Contracts:**
  - **postedReceivableCid:** `003b57a63c2e2cdb8c85385308fe929dacc7777ddb270c05…`

### 4. Create financing round factory — ok

Supplier creates FinancingRoundFactory.

- **Act as:** `meridian-supplier-1`
- **Update ID:** `12201e4c850c28af3cdbafc825799dec00728db2443c19721301555e192f3dcc5339`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/12201e4c850c28af3cdbafc825799dec00728db2443c19721301555e192f3dcc5339)
- **Contracts:**
  - **financingFactoryCid:** `00cba9e8d140cd02a3850198ce9177441ca9c1e4d81649d4…`

### 5. Open sealed-bid financing round — ok

Supplier opens FinancingRequest inviting Financier A (oracle-anchored band).

- **Act as:** `meridian-supplier-1`
- **Update ID:** `12209ceb5cf17218a8c77aa4df2fcba29f3bea786a3d89c8783347562b085688eaf2`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/12209ceb5cf17218a8c77aa4df2fcba29f3bea786a3d89c8783347562b085688eaf2)
- **Contracts:**
  - **financingRequestCid:** `00120b4163814c6de6c49066e2cc0694500462ed822b3f26…`

### 6. Submit sealed bid (Financier A) — ok

Financier A submits oracle-anchored Bid (supplier-only observer).

- **Act as:** `meridian-financier-a`
- **Update ID:** `122015e5e134a24ca0842ddbe483821aca41d737db6c0537bd2487d88ea2d74492c0`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/122015e5e134a24ca0842ddbe483821aca41d737db6c0537bd2487d88ea2d74492c0)
- **Contracts:**
  - **bidCid:** `00e9720037cf55e177a270d3d46395e903897bfeeb8b1c79…`

### 7. CIP-56 allocate MUSD advance — ok

Financier + registry create locked MusdAllocation for the advance amount.

- **Act as:** `meridian-financier-a`, `meridian-registry-1`
- **Update ID:** `122063c53adcc834a1353252d97c1c75e361058dbafe6b314f9a41666720b7c5e041`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/122063c53adcc834a1353252d97c1c75e361058dbafe6b314f9a41666720b7c5e041)
- **Contracts:**
  - **allocationCid:** `0061eef9d5fdd743e53f82fd228d9cf2127770f54a6a9d73…`

### 8. AwardBid atomic DvP — ok

Supplier + financier: execute allocation, ApplyFunding, close bids, write SettlementAuditRecord.

- **Act as:** `meridian-supplier-1`, `meridian-financier-a`
- **Update ID:** `122094109e36c5696c62b2cc4755c9f10315d34da234b0c0247522c4a85dfbb4dbf1`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/122094109e36c5696c62b2cc4755c9f10315d34da234b0c0247522c4a85dfbb4dbf1)
- **Contracts:**
  - **fundedReceivableCid:** `0050c5af3ea995a28a0dfb18ed455aa8b9c0cb70f8903192…`
  - **bidCid:** `00e9720037cf55e177a270d3d46395e903897bfeeb8b1c79…`
  - **financingRequestCid:** `00b421a96244d5721fa3d7921f8ac4849ca4f5a96d32115e…`

### 9. Create syndication factory — ok

Lead financier creates SyndicationFactory.

- **Act as:** `meridian-financier-a`
- **Update ID:** `12203a5516737d2a50741b5d9662939c7161cb5926b0928c844361ea719da43ebcd0`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/12203a5516737d2a50741b5d9662939c7161cb5926b0928c844361ea719da43ebcd0)
- **Contracts:**
  - **syndicationFactoryCid:** `00f40ef8063dbfb6be29234cf9cfb505e9508e0e7b53cbaf…`

### 10. Open syndication offering — ok

Lead opens SyndicationOffering inviting Financier B (buyer/supplier never observers).

- **Act as:** `meridian-financier-a`
- **Update ID:** `1220048aa75686f78f3cd26184a8220563a363df9062c842dbc1f90dc4bce96a1f8f`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/1220048aa75686f78f3cd26184a8220563a363df9062c842dbc1f90dc4bce96a1f8f)
- **Contracts:**
  - **offeringCid:** `008b4518f1713e955216ad3cba5fcc528f80595032f4a470…`

### 11. Submit sealed syndication bid (Financier B) — ok

Participant submits SyndicationBid (lead-only observer).

- **Act as:** `meridian-financier-b`
- **Update ID:** `1220752c72235ca083ffed2c129ceedfa0d53296755990d4b89b51e7a8790921a2b2`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/1220752c72235ca083ffed2c129ceedfa0d53296755990d4b89b51e7a8790921a2b2)
- **Contracts:**
  - **syndicationBidCid:** `003472560f3867fdbdbcd22f637f7a3f2734ed2e0ac0b91b…`

### 12. Award syndication (participation interest) — ok

Lead + participant award → ParticipationInterest + PartiallySyndicated receivable.

- **Act as:** `meridian-financier-a`, `meridian-financier-b`
- **Update ID:** `1220493276fa84d862c82105d20658e8b722f51d08e8b43a110a7fef60ace1f3d542`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/1220493276fa84d862c82105d20658e8b722f51d08e8b43a110a7fef60ace1f3d542)
- **Contracts:**
  - **syndicatedReceivableCid:** `0096d84128e7e7fbc019e3f8ec34c040f84a918dd1566486…`
  - **participationInterestCid:** `007908b0448e793d313e5cb4ff9198717cf085b628ec6962…`

### 13. CIP-56 waterfall allocation → meridian-financier-b — ok

Buyer allocates 800 MUSD to meridian-financier-b for syndicated repayment waterfall.

- **Act as:** `meridian-buyer-1`, `meridian-registry-1`
- **Update ID:** `12206c008e53ba4f715939a657fac693ea1b6d317e2d232592e0fcf5598415fefc39`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/12206c008e53ba4f715939a657fac693ea1b6d317e2d232592e0fcf5598415fefc39)
- **Contracts:**
  - **allocationCid:** `00ac0dfd9a804028c7497f0c57d1eef80a2585a0c4ebd5b9…`
  - **receiver:** `meridian-financier-b::1220a14ca128063b8dc9d1ebb0…`
  - **amount:** `800`

### 14. CIP-56 waterfall allocation → meridian-financier-a — ok

Buyer allocates 1200 MUSD to meridian-financier-a for syndicated repayment waterfall.

- **Act as:** `meridian-buyer-1`, `meridian-registry-1`
- **Update ID:** `1220e39209aec219527a6c79b6cccb6d59a8b7e248ff3f8523984433f7d08f7b4f06`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/1220e39209aec219527a6c79b6cccb6d59a8b7e248ff3f8523984433f7d08f7b4f06)
- **Contracts:**
  - **allocationCid:** `0030e78c1fccbbf1816096a8991e4b7c3b785612bf243e13…`
  - **receiver:** `meridian-financier-a::1220a14ca128063b8dc9d1ebb0…`
  - **amount:** `1200`

### 15. Waterfall RepayWithProof — ok

Buyer + lead + supplier + participant: execute repayment allocations and create RepaymentProof.

- **Act as:** `meridian-buyer-1`, `meridian-financier-a`, `meridian-supplier-1`, `meridian-financier-b`
- **Update ID:** `1220b852a2748e345ea8a274a5b6d29d37889edd5655fa5ae5bf71c944cee716e97c`
- **Explorer:** [Open transaction](https://lighthouse.devnet.cantonloop.com/transactions/1220b852a2748e345ea8a274a5b6d29d37889edd5655fa5ae5bf71c944cee716e97c)
- **Contracts:**
  - **repaidReceivableCid:** `0012b1af725d9dc160b1af013d2e859a0a0a8d78635c1fb5…`
  - **repaymentProofCid:** `00710c827c1bec19409e5bdf2f19562ef3ac83d7d63e47da…`

See also [TRANSACTIONS.md](./TRANSACTIONS.md).
