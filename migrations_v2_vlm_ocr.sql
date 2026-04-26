-- ============================================================================
-- AssetCues VLM-OCR Extraction Engine — Full PostgreSQL Migration Script
-- Generated: 2026-04-25
-- Supabase Project: assetcuesfar (fhitjckyalqoyrkhyjrg)
-- Compatible with PostgreSQL 17+
-- Designed for VLM-OCR-MODEL-V1.4 extraction pipeline
-- ============================================================================
--
-- ARCHITECTURE NOTES:
-- - Maps 1:1 to VLM-OCR Pydantic models (IndividualAsset, AssetImageIdentification)
-- - Per-field confidence columns for critical AI-extracted fields
-- - Tracking config (indicator, tracking_methods, audit_methods) as JSONB
-- - Invoice provenance as JSONB (invoice, PO, PR, GRN, vendor trace)
-- - Supports: standard extraction, precise extraction, image identification, enrichment
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Auto-incrementing asset ID starting at 1 billion + 1
CREATE SEQUENCE IF NOT EXISTS asset_id_seq START WITH 1000000001;

-- ============================================================================
-- TABLE 1: organizations
-- ============================================================================
CREATE TABLE IF NOT EXISTS organizations (
    id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        text        NOT NULL,
    gst_number  text,
    pan_number  text,
    address     text,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 2: locations
-- ============================================================================
CREATE TABLE IF NOT EXISTS locations (
    id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id      uuid        REFERENCES organizations(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    address     text,
    city        text,
    state       text,
    pincode     text,
    created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_locations_org ON locations (org_id);

-- ============================================================================
-- TABLE 3: departments
-- ============================================================================
CREATE TABLE IF NOT EXISTS departments (
    id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id      uuid        REFERENCES organizations(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    cost_center text,
    head_name   text,
    created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_departments_org ON departments (org_id);

-- ============================================================================
-- TABLE 4: extractions — Invoice extraction records from VLM-OCR pipeline
-- ============================================================================
-- Supports both standard (FAR Manager) and precise (spreadsheet) extraction modes.
CREATE TABLE IF NOT EXISTS extractions (
    id                  uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              uuid        REFERENCES organizations(id) ON DELETE SET NULL,

    -- File info
    file_name           text,
    file_url            text,
    file_hash           text,

    -- Extraction type: 'standard' (FAR Manager AI) or 'precise' (spreadsheet-style)
    extraction_type     text        DEFAULT 'standard'
                                    CHECK (extraction_type IN ('standard', 'precise')),

    -- Workflow status
    status              text        DEFAULT 'processing'
                                    CHECK (status IN ('processing', 'draft', 'approved', 'rejected')),

    -- Raw extraction outputs (JSONB for flexible querying)
    extraction_json     jsonb,                          -- Stage 1 raw LLM output (data field)
    generated_assets    jsonb,                          -- Stage 2 generated assets array (assets field)
    precise_rows        jsonb,                          -- Precise mode: PreciseInvoiceRow[]
    page_analyses       jsonb,                          -- Precise mode: PrecisePageAnalysis[]
    invoice_groups      jsonb,                          -- Precise mode: PreciseInvoiceGroupAnalysis[]
    invoice_summary     jsonb,                          -- Precise mode: PreciseInvoiceSummary

    -- Extracted header fields (denormalized for fast queries)
    vendor_name         text,
    invoice_number      text,
    invoice_date        date,
    po_number           text,
    po_date             date,
    grand_total         numeric     DEFAULT 0,
    currency            text        DEFAULT 'INR',

    -- AI extraction confidence
    confidence          numeric     DEFAULT 0,

    -- Math validation results
    math_validation     jsonb       DEFAULT '{}',

    -- Duplicate detection
    duplicate_of        uuid        REFERENCES extractions(id) ON DELETE SET NULL,

    -- Pipeline metadata (provider, model, tokens, processing time)
    extraction_metadata jsonb       DEFAULT '{}',

    -- User tracking
    uploaded_by         uuid,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extractions_org ON extractions (org_id);
CREATE INDEX IF NOT EXISTS idx_extractions_status ON extractions (status);
CREATE INDEX IF NOT EXISTS idx_extractions_type ON extractions (extraction_type);
CREATE INDEX IF NOT EXISTS idx_extractions_file_hash ON extractions (file_hash);
CREATE INDEX IF NOT EXISTS idx_extractions_invoice_vendor ON extractions (invoice_number, vendor_name);
CREATE INDEX IF NOT EXISTS idx_extractions_created ON extractions (created_at DESC);

-- ============================================================================
-- TABLE 5: assets — Individual asset records (VLM-OCR IndividualAsset model)
-- ============================================================================
-- Maps 1:1 to the VLM-OCR IndividualAsset Pydantic model.
-- Includes per-field confidence, tracking config, invoice provenance.
CREATE TABLE IF NOT EXISTS assets (
    id                          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id                      uuid        REFERENCES organizations(id) ON DELETE SET NULL,
    extraction_id               uuid        REFERENCES extractions(id) ON DELETE SET NULL,

    -- System IDs
    asset_id                    bigint      UNIQUE DEFAULT nextval('asset_id_seq'),
    asset_number                text        NOT NULL,
    dummy_asset_number          text,

    -- Core identity
    name                        text        NOT NULL,
    name_confidence             numeric     DEFAULT 1.0,
    description                 text,
    description_confidence      numeric     DEFAULT 1.0,

    -- Classification (AssetCategorySuggestion)
    category                    text,
    sub_category                text,
    asset_class                 text,
    asset_type                  text,
    asset_criticality           text,
    category_confidence         numeric     DEFAULT 1.0,
    make                        text,
    model                       text,

    -- Identification
    serial_number               text,
    hsn_code                    text,
    barcode                     text,
    barcode_raw_data            text,
    qr_code_data                text,

    -- Financials (mathematically distributed)
    purchase_price              numeric     DEFAULT 0,
    cost_confidence             numeric     DEFAULT 1.0,
    cgst                        numeric     DEFAULT 0,
    sgst                        numeric     DEFAULT 0,
    igst                        numeric     DEFAULT 0,
    tax                         numeric     DEFAULT 0,
    taxes_detail                jsonb       DEFAULT '{}',
    taxes_confidence            numeric     DEFAULT 1.0,
    installation_charges        numeric     DEFAULT 0,
    installation_confidence     numeric     DEFAULT 1.0,
    total_cost                  numeric     DEFAULT 0,
    currency                    text        DEFAULT 'INR',

    -- Invoice metadata
    invoice_date                date,
    acquisition_date            date,
    vendor                      text,
    invoice_number              text,

    -- Relationships (parent-child)
    parent_asset_id             uuid        REFERENCES assets(id) ON DELETE SET NULL,
    parent_asset_dummy_number   text,
    asset_group_id              text,
    child_index                 int,
    group_reason                text,
    is_parent_asset             boolean     DEFAULT true,
    is_parent_confidence        numeric     DEFAULT 1.0,

    -- Unit / Bulk
    unit_of_measure             text        DEFAULT 'Nos',
    bulk_quantity               numeric,
    is_bulk_asset               boolean     DEFAULT false,

    -- Location / Assignment
    location_id                 uuid        REFERENCES locations(id) ON DELETE SET NULL,
    department_id               uuid        REFERENCES departments(id) ON DELETE SET NULL,
    plant_location              text,
    assigned_to                 text,
    cost_center                 text,

    -- Depreciation
    useful_life_years           numeric,
    depreciation_method         text        DEFAULT 'SLM'
                                            CHECK (depreciation_method IN ('SLM', 'WDV')),
    depreciation_rate           numeric,
    salvage_value               numeric     DEFAULT 1,

    -- Warranty
    warranty_start_date         date,
    warranty_end_date           date,
    warranty_provider           text,
    warranty_number             text,

    -- AMC
    amc_start_date              date,
    amc_end_date                date,
    amc_provider                text,
    amc_cost                    numeric,

    -- Condition (VLM-OCR)
    condition                   text        DEFAULT 'New',
    condition_source            text        DEFAULT 'default',
    condition_details           text,

    -- Tracking config (rules engine)
    tracking_config             jsonb       DEFAULT '{}',
    tracking_config_confidence  numeric     DEFAULT 1.0,
    tracking_config_source      text        DEFAULT 'rules',

    -- Invoice provenance (deterministic)
    invoice_provenance          jsonb       DEFAULT '{}',

    -- Asset source
    source                      text        DEFAULT 'invoice'
                                            CHECK (source IN ('invoice', 'asset_image', 'combined', 'manual')),

    -- Workflow
    status                      text        DEFAULT 'in_review'
                                            CHECK (status IN ('in_review', 'verified', 'active',
                                                              'retired', 'disposed', 'transferred',
                                                              'quarantined')),
    verification_date           timestamptz,
    verified_by                 text,

    -- Images
    asset_image_url             text,
    barcode_image_url           text,

    -- Overall confidence
    confidence                  numeric     DEFAULT 0,

    -- Extensible
    custom_fields               jsonb       DEFAULT '{}',
    tags                        text[]      DEFAULT '{}',

    created_at                  timestamptz DEFAULT now(),
    updated_at                  timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_asset_number ON assets (asset_number, org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_asset_id ON assets (asset_id);
CREATE INDEX IF NOT EXISTS idx_assets_org ON assets (org_id);
CREATE INDEX IF NOT EXISTS idx_assets_extraction ON assets (extraction_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets (status);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets (category);
CREATE INDEX IF NOT EXISTS idx_assets_vendor ON assets (vendor);
CREATE INDEX IF NOT EXISTS idx_assets_serial ON assets (serial_number);
CREATE INDEX IF NOT EXISTS idx_assets_parent ON assets (parent_asset_id);
CREATE INDEX IF NOT EXISTS idx_assets_location ON assets (location_id);
CREATE INDEX IF NOT EXISTS idx_assets_department ON assets (department_id);
CREATE INDEX IF NOT EXISTS idx_assets_source ON assets (source);
CREATE INDEX IF NOT EXISTS idx_assets_warranty_end ON assets (warranty_end_date);
CREATE INDEX IF NOT EXISTS idx_assets_created ON assets (created_at DESC);

-- ============================================================================
-- TABLE 6: asset_identifications — Asset image identification results
-- ============================================================================
-- Maps to VLM-OCR AssetImageIdentification model.
CREATE TABLE IF NOT EXISTS asset_identifications (
    id                          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id                      uuid        REFERENCES organizations(id) ON DELETE SET NULL,
    asset_id                    uuid        REFERENCES assets(id) ON DELETE SET NULL,

    -- Tier 1: Visually Extracted
    asset_name                  text,
    asset_name_confidence       numeric     DEFAULT 0,
    asset_description           text,
    asset_description_confidence numeric    DEFAULT 0,
    manufacturer                text,
    manufacturer_confidence     numeric     DEFAULT 0,
    make_model                  text,
    make_model_confidence       numeric     DEFAULT 0,
    serial_number               text,
    serial_number_confidence    numeric     DEFAULT 0,
    asset_tag_number            text,
    asset_tag_number_confidence numeric     DEFAULT 0,
    asset_condition             text,
    asset_condition_confidence  numeric     DEFAULT 0,
    condition_details           text,
    condition_details_confidence numeric    DEFAULT 0,

    -- Tier 2: AI Suggested
    category_suggestion         jsonb,
    category_confidence         numeric     DEFAULT 0,
    asset_class                 text,
    asset_class_confidence      numeric     DEFAULT 0,
    asset_type                  text,
    asset_type_confidence       numeric     DEFAULT 0,
    asset_criticality           text,
    asset_criticality_confidence numeric    DEFAULT 0,

    -- Tracking config
    tracking_config             jsonb       DEFAULT '{}',
    tracking_config_confidence  numeric     DEFAULT 1.0,
    tracking_config_source      text        DEFAULT 'rules',

    -- Barcode
    barcode_raw_data            text,
    barcode_raw_data_confidence numeric     DEFAULT 0,

    -- Additional observations
    additional_observations     jsonb       DEFAULT '{}',

    -- Source & metadata
    source                      text        DEFAULT 'asset_image',
    fields_requiring_invoice    text[]      DEFAULT '{}',
    asset_image_url             text,
    barcode_image_url           text,
    identification_metadata     jsonb       DEFAULT '{}',

    -- Status
    status                      text        DEFAULT 'completed'
                                            CHECK (status IN ('processing', 'completed', 'failed')),
    created_at                  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identifications_asset ON asset_identifications (asset_id);
CREATE INDEX IF NOT EXISTS idx_identifications_org ON asset_identifications (org_id);
CREATE INDEX IF NOT EXISTS idx_identifications_created ON asset_identifications (created_at DESC);

-- ============================================================================
-- TABLE 7: asset_enrichments — Cross-validation sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS asset_enrichments (
    id                      uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id                uuid        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    extraction_id           uuid        REFERENCES extractions(id) ON DELETE SET NULL,
    identification_id       uuid        REFERENCES asset_identifications(id) ON DELETE SET NULL,

    enrichment_type         text        DEFAULT 'image_enhance'
                                        CHECK (enrichment_type IN ('image_enhance', 'invoice_enrich')),

    enhanced_data           jsonb,
    enhancements            jsonb       DEFAULT '[]',
    match_result            jsonb,
    enrichment_metadata     jsonb       DEFAULT '{}',

    status                  text        DEFAULT 'completed'
                                        CHECK (status IN ('pending', 'completed', 'failed', 'applied')),
    applied_at              timestamptz,
    applied_by              text,
    created_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrichments_asset ON asset_enrichments (asset_id);
CREATE INDEX IF NOT EXISTS idx_enrichments_extraction ON asset_enrichments (extraction_id);
CREATE INDEX IF NOT EXISTS idx_enrichments_created ON asset_enrichments (created_at DESC);

-- ============================================================================
-- TABLE 8: audit_trail — Field-level change log
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_trail (
    id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id       uuid        REFERENCES assets(id) ON DELETE SET NULL,
    extraction_id  uuid        REFERENCES extractions(id) ON DELETE SET NULL,
    action         text        NOT NULL,
    field_name     text,
    old_value      text,
    new_value      text,
    performed_by   text,
    notes          text,
    source         text,
    created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_asset ON audit_trail (asset_id);
CREATE INDEX IF NOT EXISTS idx_audit_extraction ON audit_trail (extraction_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_trail (created_at DESC);

-- ============================================================================
-- TABLE 9: asset_invoices — Multi-invoice linkage
-- ============================================================================
CREATE TABLE IF NOT EXISTS asset_invoices (
    id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id       uuid        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    extraction_id  uuid        REFERENCES extractions(id) ON DELETE SET NULL,
    invoice_type   text        DEFAULT 'purchase'
                               CHECK (invoice_type IN ('purchase', 'warranty', 'amc',
                                                       'repair', 'upgrade', 'insurance')),
    invoice_number text,
    invoice_date   date,
    amount         numeric,
    description    text,
    file_url       text,
    created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_invoices_asset ON asset_invoices (asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_invoices_extraction ON asset_invoices (extraction_id);

-- ============================================================================
-- TABLE 10: anomaly_alerts — Detection alerts
-- ============================================================================
CREATE TABLE IF NOT EXISTS anomaly_alerts (
    id                    uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id                uuid        REFERENCES organizations(id) ON DELETE SET NULL,
    alert_type            text        NOT NULL
                                      CHECK (alert_type IN ('duplicate_invoice', 'duplicate_serial',
                                                            'price_outlier', 'vendor_anomaly',
                                                            'math_mismatch', 'warranty_expiring',
                                                            'missing_data', 'verification_mismatch',
                                                            'confidence_low')),
    severity              text        DEFAULT 'medium'
                                      CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    title                 text        NOT NULL,
    description           text,
    related_asset_id      uuid        REFERENCES assets(id) ON DELETE SET NULL,
    related_extraction_id uuid        REFERENCES extractions(id) ON DELETE SET NULL,
    alert_data            jsonb       DEFAULT '{}',
    is_resolved           boolean     DEFAULT false,
    resolved_by           text,
    resolved_at           timestamptz,
    resolution_notes      text,
    created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anomalies_org ON anomaly_alerts (org_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_unresolved ON anomaly_alerts (is_resolved) WHERE is_resolved = false;
CREATE INDEX IF NOT EXISTS idx_anomalies_asset ON anomaly_alerts (related_asset_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_extraction ON anomaly_alerts (related_extraction_id);

-- ============================================================================
-- TABLE 11: depreciation_entries — Fiscal year depreciation ledger
-- ============================================================================
CREATE TABLE IF NOT EXISTS depreciation_entries (
    id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id             uuid        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    fiscal_year          text        NOT NULL,
    opening_value        numeric     NOT NULL,
    depreciation_amount  numeric     NOT NULL,
    closing_value        numeric     NOT NULL,
    method               text        NOT NULL,
    rate                 numeric,
    days_used            int         DEFAULT 365,
    created_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_depreciation_asset ON depreciation_entries (asset_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_fy ON depreciation_entries (fiscal_year);

-- ============================================================================
-- TABLE 12: physical_audits — Field audit scans
-- ============================================================================
CREATE TABLE IF NOT EXISTS physical_audits (
    id                uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id          uuid        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    audited_by        text,
    audit_method      text        DEFAULT 'barcode_scan'
                                  CHECK (audit_method IN ('qr_scan', 'barcode_scan',
                                                          'manual', 'photo_verification',
                                                          'rfid_scan', 'gps_check')),
    location_verified text,
    condition         text        CHECK (condition IN ('good', 'fair', 'poor',
                                                       'damaged', 'missing')),
    photo_url         text,
    notes             text,
    gps_lat           numeric,
    gps_lng           numeric,
    scanned_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audits_asset ON physical_audits (asset_id);
CREATE INDEX IF NOT EXISTS idx_audits_date ON physical_audits (scanned_at DESC);

-- ============================================================================
-- TABLE 13: vendor_profiles — Vendor master
-- ============================================================================
CREATE TABLE IF NOT EXISTS vendor_profiles (
    id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id         uuid        REFERENCES organizations(id) ON DELETE SET NULL,
    vendor_name    text        NOT NULL,
    gstin          text,
    pan            text,
    contact_email  text,
    contact_phone  text,
    address        text,
    is_frequent    boolean     DEFAULT false,
    custom_fields  jsonb       DEFAULT '[]',
    created_at     timestamptz DEFAULT now(),
    updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendors_org ON vendor_profiles (org_id);
CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendor_profiles (vendor_name);

-- ============================================================================
-- TABLE 14: asset_templates — Reusable asset type templates
-- ============================================================================
CREATE TABLE IF NOT EXISTS asset_templates (
    id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id               uuid        REFERENCES organizations(id) ON DELETE SET NULL,
    name                 text        NOT NULL,
    category             text        NOT NULL,
    sub_category         text,
    asset_class          text,
    useful_life_years    numeric,
    depreciation_method  text        DEFAULT 'SLM',
    depreciation_rate    numeric,
    default_fields       jsonb       DEFAULT '{}',
    tracking_config      jsonb       DEFAULT '{}',
    icon                 text        DEFAULT 'devices',
    created_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_templates_org ON asset_templates (org_id);
CREATE INDEX IF NOT EXISTS idx_templates_category ON asset_templates (category);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_extraction_cascade(p_extraction_id uuid)
RETURNS void AS $$
BEGIN
    DELETE FROM asset_enrichments
    WHERE extraction_id = p_extraction_id
       OR asset_id IN (SELECT id FROM assets WHERE extraction_id = p_extraction_id);

    DELETE FROM asset_identifications
    WHERE asset_id IN (SELECT id FROM assets WHERE extraction_id = p_extraction_id);

    DELETE FROM anomaly_alerts
    WHERE related_asset_id IN (SELECT id FROM assets WHERE extraction_id = p_extraction_id);
    DELETE FROM anomaly_alerts WHERE related_extraction_id = p_extraction_id;

    DELETE FROM depreciation_entries
    WHERE asset_id IN (SELECT id FROM assets WHERE extraction_id = p_extraction_id);

    DELETE FROM physical_audits
    WHERE asset_id IN (SELECT id FROM assets WHERE extraction_id = p_extraction_id);

    DELETE FROM asset_invoices
    WHERE extraction_id = p_extraction_id
       OR asset_id IN (SELECT id FROM assets WHERE extraction_id = p_extraction_id);

    DELETE FROM audit_trail
    WHERE extraction_id = p_extraction_id
       OR asset_id IN (SELECT id FROM assets WHERE extraction_id = p_extraction_id);

    UPDATE assets SET parent_asset_id = NULL
    WHERE extraction_id = p_extraction_id AND parent_asset_id IS NOT NULL;

    DELETE FROM assets WHERE extraction_id = p_extraction_id;

    UPDATE extractions SET duplicate_of = NULL WHERE duplicate_of = p_extraction_id;

    DELETE FROM extractions WHERE id = p_extraction_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
DROP TRIGGER IF EXISTS tr_assets_updated ON assets;
CREATE TRIGGER tr_assets_updated
    BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tr_extractions_updated ON extractions;
CREATE TRIGGER tr_extractions_updated
    BEFORE UPDATE ON extractions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tr_organizations_updated ON organizations;
CREATE TRIGGER tr_organizations_updated
    BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tr_vendor_profiles_updated ON vendor_profiles;
CREATE TRIGGER tr_vendor_profiles_updated
    BEFORE UPDATE ON vendor_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- SEED DATA
-- ============================================================================

INSERT INTO organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'AssetCues Demo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (org_id, name, city, state) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Head Office',              'Bangalore', 'Karnataka'),
    ('00000000-0000-0000-0000-000000000001', 'Warehouse Marathahalli',   'Bangalore', 'Karnataka'),
    ('00000000-0000-0000-0000-000000000001', 'Mumbai Office',            'Mumbai',    'Maharashtra'),
    ('00000000-0000-0000-0000-000000000001', 'Delhi NCR',                'Delhi',     'Delhi'),
    ('00000000-0000-0000-0000-000000000001', 'Chennai Office',           'Chennai',   'Tamil Nadu')
ON CONFLICT DO NOTHING;

INSERT INTO departments (org_id, name) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Engineering'),
    ('00000000-0000-0000-0000-000000000001', 'Finance'),
    ('00000000-0000-0000-0000-000000000001', 'Operations'),
    ('00000000-0000-0000-0000-000000000001', 'HR & Admin'),
    ('00000000-0000-0000-0000-000000000001', 'Sales')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- STORAGE NOTE
-- ============================================================================
-- Create a public bucket named 'asset-images' for storing
-- asset photographs, invoice scans, barcode images, and QR code images.
-- ============================================================================

-- Done.
