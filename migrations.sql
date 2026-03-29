-- ============================================================================
-- AssetCues — Full PostgreSQL Migration Script
-- Generated: 2026-03-29
-- Compatible with PostgreSQL 15+
-- Idempotent: safe to run multiple times against the same database
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- SEQUENCE
-- ============================================================================
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
    org_id      uuid        REFERENCES organizations(id),
    name        text        NOT NULL,
    address     text,
    city        text,
    state       text,
    pincode     text,
    created_at  timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 3: departments
-- ============================================================================
CREATE TABLE IF NOT EXISTS departments (
    id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id      uuid        REFERENCES organizations(id),
    name        text        NOT NULL,
    cost_center text,
    head_name   text,
    created_at  timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 4: extractions
-- ============================================================================
CREATE TABLE IF NOT EXISTS extractions (
    id               uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id           uuid        REFERENCES organizations(id),
    file_name        text,
    file_url         text,
    file_hash        text,
    status           text        DEFAULT 'processing'
                                 CHECK (status IN ('processing', 'draft', 'approved', 'rejected')),
    extraction_json  jsonb,
    vendor_name      text,
    invoice_number   text,
    invoice_date     date,
    grand_total      numeric     DEFAULT 0,
    confidence       numeric     DEFAULT 0,
    math_validation  jsonb       DEFAULT '{}',
    duplicate_of     uuid        REFERENCES extractions(id),
    uploaded_by      uuid,
    created_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 5: assets
-- ============================================================================
CREATE TABLE IF NOT EXISTS assets (
    id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id               uuid        REFERENCES organizations(id),
    extraction_id        uuid        REFERENCES extractions(id),
    asset_id             bigint      UNIQUE DEFAULT nextval('asset_id_seq'),
    asset_number         text        NOT NULL,
    name                 text        NOT NULL,
    description          text,
    category             text,
    sub_category         text,
    asset_class          text,
    make                 text,
    model                text,
    purchase_price       numeric     DEFAULT 0,
    cgst                 numeric     DEFAULT 0,
    sgst                 numeric     DEFAULT 0,
    igst                 numeric     DEFAULT 0,
    tax                  numeric     DEFAULT 0,
    total_cost           numeric     DEFAULT 0,
    serial_number        text,
    hsn_code             text,
    barcode              text,
    qr_code_data         text,
    invoice_date         date,
    acquisition_date     date,
    vendor               text,
    invoice_number       text,
    parent_asset_id      uuid        REFERENCES assets(id),
    child_index          int,
    group_reason         text,
    unit_of_measure      text        DEFAULT 'Nos',
    bulk_quantity        numeric,
    is_bulk_asset        boolean     DEFAULT false,
    location_id          uuid        REFERENCES locations(id),
    department_id        uuid        REFERENCES departments(id),
    assigned_to          text,
    cost_center          text,
    useful_life_years    numeric,
    depreciation_method  text        DEFAULT 'SLM'
                                     CHECK (depreciation_method IN ('SLM', 'WDV')),
    depreciation_rate    numeric,
    salvage_value        numeric     DEFAULT 1,
    warranty_start_date  date,
    warranty_end_date    date,
    warranty_provider    text,
    amc_start_date       date,
    amc_end_date         date,
    amc_provider         text,
    amc_cost             numeric,
    status               text        DEFAULT 'in_review'
                                     CHECK (status IN ('in_review', 'verified', 'active',
                                                       'retired', 'disposed', 'transferred')),
    verification_date    timestamptz,
    verified_by          text,
    asset_image_url      text,
    confidence           numeric     DEFAULT 0,
    custom_fields        jsonb       DEFAULT '{}',
    tags                 text[]      DEFAULT '{}',
    created_at           timestamptz DEFAULT now(),
    updated_at           timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 6: audit_trail
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_trail (
    id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id       uuid        REFERENCES assets(id),
    extraction_id  uuid        REFERENCES extractions(id),
    action         text        NOT NULL,
    field_name     text,
    old_value      text,
    new_value      text,
    performed_by   text,
    notes          text,
    created_at     timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 7: asset_invoices
-- ============================================================================
CREATE TABLE IF NOT EXISTS asset_invoices (
    id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id       uuid        NOT NULL REFERENCES assets(id),
    extraction_id  uuid        REFERENCES extractions(id),
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

-- ============================================================================
-- TABLE 8: anomaly_alerts
-- ============================================================================
CREATE TABLE IF NOT EXISTS anomaly_alerts (
    id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id               uuid        REFERENCES organizations(id),
    alert_type           text        NOT NULL
                                     CHECK (alert_type IN ('duplicate_invoice', 'duplicate_serial',
                                                           'price_outlier', 'vendor_anomaly',
                                                           'math_mismatch', 'warranty_expiring',
                                                           'missing_data')),
    severity             text        DEFAULT 'medium'
                                     CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    title                text        NOT NULL,
    description          text,
    related_asset_id     uuid        REFERENCES assets(id),
    related_extraction_id uuid       REFERENCES extractions(id),
    is_resolved          boolean     DEFAULT false,
    resolved_by          text,
    resolved_at          timestamptz,
    created_at           timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 9: depreciation_entries
-- ============================================================================
CREATE TABLE IF NOT EXISTS depreciation_entries (
    id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id             uuid        NOT NULL REFERENCES assets(id),
    fiscal_year          text        NOT NULL,
    opening_value        numeric     NOT NULL,
    depreciation_amount  numeric     NOT NULL,
    closing_value        numeric     NOT NULL,
    method               text        NOT NULL,
    rate                 numeric,
    days_used            int         DEFAULT 365,
    created_at           timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 10: physical_audits
-- ============================================================================
CREATE TABLE IF NOT EXISTS physical_audits (
    id                uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id          uuid        NOT NULL REFERENCES assets(id),
    audited_by        text,
    audit_method      text        DEFAULT 'qr_scan'
                                  CHECK (audit_method IN ('qr_scan', 'barcode_scan',
                                                          'manual', 'photo_verification')),
    location_verified text,
    condition         text        CHECK (condition IN ('good', 'fair', 'poor',
                                                       'damaged', 'missing')),
    photo_url         text,
    notes             text,
    gps_lat           numeric,
    gps_lng           numeric,
    scanned_at        timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 11: vendor_profiles
-- ============================================================================
CREATE TABLE IF NOT EXISTS vendor_profiles (
    id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id         uuid        REFERENCES organizations(id),
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

-- ============================================================================
-- TABLE 12: asset_templates
-- ============================================================================
CREATE TABLE IF NOT EXISTS asset_templates (
    id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id               uuid        REFERENCES organizations(id),
    name                 text        NOT NULL,
    category             text        NOT NULL,
    sub_category         text,
    asset_class          text,
    useful_life_years    numeric,
    depreciation_method  text        DEFAULT 'SLM',
    depreciation_rate    numeric,
    default_fields       jsonb       DEFAULT '{}',
    icon                 text        DEFAULT 'devices',
    created_at           timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES — assets
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_asset_number
    ON assets (asset_number, org_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_asset_id
    ON assets (asset_id);

CREATE INDEX IF NOT EXISTS idx_assets_org
    ON assets (org_id);

CREATE INDEX IF NOT EXISTS idx_assets_status
    ON assets (status);

CREATE INDEX IF NOT EXISTS idx_assets_category
    ON assets (category);

CREATE INDEX IF NOT EXISTS idx_assets_vendor
    ON assets (vendor);

CREATE INDEX IF NOT EXISTS idx_assets_serial
    ON assets (serial_number);

CREATE INDEX IF NOT EXISTS idx_assets_parent
    ON assets (parent_asset_id);

CREATE INDEX IF NOT EXISTS idx_assets_location
    ON assets (location_id);

CREATE INDEX IF NOT EXISTS idx_assets_department
    ON assets (department_id);

CREATE INDEX IF NOT EXISTS idx_assets_warranty_end
    ON assets (warranty_end_date);

-- ============================================================================
-- INDEXES — extractions
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_extractions_org
    ON extractions (org_id);

CREATE INDEX IF NOT EXISTS idx_extractions_file_hash
    ON extractions (file_hash);

CREATE INDEX IF NOT EXISTS idx_extractions_invoice_vendor
    ON extractions (invoice_number, vendor_name);

-- ============================================================================
-- INDEXES — audit_trail
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_audit_asset
    ON audit_trail (asset_id);

CREATE INDEX IF NOT EXISTS idx_audit_extraction
    ON audit_trail (extraction_id);

-- ============================================================================
-- INDEXES — asset_invoices
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_asset_invoices_asset
    ON asset_invoices (asset_id);

-- ============================================================================
-- INDEXES — anomaly_alerts
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_anomalies_org
    ON anomaly_alerts (org_id);

CREATE INDEX IF NOT EXISTS idx_anomalies_unresolved
    ON anomaly_alerts (is_resolved)
    WHERE is_resolved = false;

-- ============================================================================
-- INDEXES — depreciation_entries
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_depreciation_asset
    ON depreciation_entries (asset_id);

CREATE INDEX IF NOT EXISTS idx_depreciation_fy
    ON depreciation_entries (fiscal_year);

-- ============================================================================
-- INDEXES — physical_audits
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_audits_asset
    ON physical_audits (asset_id);

CREATE INDEX IF NOT EXISTS idx_audits_date
    ON physical_audits (scanned_at);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Trigger function: automatically set updated_at to NOW() on row update
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Cascade-delete an extraction and all linked records in FK-safe order
CREATE OR REPLACE FUNCTION delete_extraction_cascade(p_extraction_id uuid)
RETURNS void AS $$
BEGIN
    -- 1. Delete anomaly alerts linked to assets from this extraction
    DELETE FROM anomaly_alerts
    WHERE related_asset_id IN (
        SELECT id FROM assets WHERE extraction_id = p_extraction_id
    );

    -- 2. Delete anomaly alerts linked directly to this extraction
    DELETE FROM anomaly_alerts
    WHERE related_extraction_id = p_extraction_id;

    -- 3. Delete depreciation entries for assets from this extraction
    DELETE FROM depreciation_entries
    WHERE asset_id IN (
        SELECT id FROM assets WHERE extraction_id = p_extraction_id
    );

    -- 4. Delete physical audits for assets from this extraction
    DELETE FROM physical_audits
    WHERE asset_id IN (
        SELECT id FROM assets WHERE extraction_id = p_extraction_id
    );

    -- 5. Delete asset invoices for assets from this extraction
    DELETE FROM asset_invoices
    WHERE extraction_id = p_extraction_id
       OR asset_id IN (
            SELECT id FROM assets WHERE extraction_id = p_extraction_id
        );

    -- 6. Delete audit trail entries for this extraction and its assets
    DELETE FROM audit_trail
    WHERE extraction_id = p_extraction_id
       OR asset_id IN (
            SELECT id FROM assets WHERE extraction_id = p_extraction_id
        );

    -- 7. Clear parent_asset_id self-references before deleting assets
    UPDATE assets
    SET parent_asset_id = NULL
    WHERE extraction_id = p_extraction_id
      AND parent_asset_id IS NOT NULL;

    -- 8. Delete the assets themselves
    DELETE FROM assets
    WHERE extraction_id = p_extraction_id;

    -- 9. Clear duplicate_of self-references if they point to this extraction
    UPDATE extractions
    SET duplicate_of = NULL
    WHERE duplicate_of = p_extraction_id;

    -- 10. Delete the extraction
    DELETE FROM extractions
    WHERE id = p_extraction_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Drop-if-exists then create ensures idempotency for triggers
DROP TRIGGER IF EXISTS tr_assets_updated ON assets;
CREATE TRIGGER tr_assets_updated
    BEFORE UPDATE ON assets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tr_extractions_updated ON extractions;
CREATE TRIGGER tr_extractions_updated
    BEFORE UPDATE ON extractions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tr_organizations_updated ON organizations;
CREATE TRIGGER tr_organizations_updated
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tr_vendor_profiles_updated ON vendor_profiles;
CREATE TRIGGER tr_vendor_profiles_updated
    BEFORE UPDATE ON vendor_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Default organization
INSERT INTO organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'AssetCues Demo')
ON CONFLICT (id) DO NOTHING;

-- Locations
INSERT INTO locations (id, org_id, name, city, state) VALUES
    (uuid_generate_v4(), '00000000-0000-0000-0000-000000000001',
     'Head Office',              'Bangalore', 'Karnataka'),
    (uuid_generate_v4(), '00000000-0000-0000-0000-000000000001',
     'Warehouse Marathahalli',   'Bangalore', 'Karnataka'),
    (uuid_generate_v4(), '00000000-0000-0000-0000-000000000001',
     'Mumbai Office',            'Mumbai',    'Maharashtra'),
    (uuid_generate_v4(), '00000000-0000-0000-0000-000000000001',
     'Delhi NCR',                'Delhi',     'Delhi'),
    (uuid_generate_v4(), '00000000-0000-0000-0000-000000000001',
     'Chennai Office',           'Chennai',   'Tamil Nadu')
ON CONFLICT DO NOTHING;

-- Departments
INSERT INTO departments (id, org_id, name) VALUES
    (uuid_generate_v4(), '00000000-0000-0000-0000-000000000001', 'Engineering'),
    (uuid_generate_v4(), '00000000-0000-0000-0000-000000000001', 'Finance'),
    (uuid_generate_v4(), '00000000-0000-0000-0000-000000000001', 'Operations'),
    (uuid_generate_v4(), '00000000-0000-0000-0000-000000000001', 'HR & Admin'),
    (uuid_generate_v4(), '00000000-0000-0000-0000-000000000001', 'Sales')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- STORAGE NOTE
-- ============================================================================
-- Supabase Storage: Create a public bucket named 'asset-images' for storing
-- asset photographs, invoice scans, and QR code images.
--
-- Via Supabase Dashboard:
--   1. Go to Storage → New Bucket
--   2. Name: asset-images
--   3. Public bucket: ON
--   4. Allowed MIME types: image/png, image/jpeg, image/webp, application/pdf
--
-- Or via SQL (Supabase-specific):
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES ('asset-images', 'asset-images', true)
--   ON CONFLICT (id) DO NOTHING;
-- ============================================================================

-- Done.
