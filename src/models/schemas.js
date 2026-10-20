/**
 * Database Schemas for Defect Automation System
 * These schemas define the structure for defects, test cases, RCAs and their mappings
 */

const defectSchema = {
    // SIMPLIFIED SCHEMA: Store Native vendor Data with Minimal Transformation
    // This approach preserves all original vendor fields exactly as received
    // making testing, matching, and integration much easier
    
    // Core vendor identifiers (required)
    sys_id: {
        type: 'string',
        required: true,
        description: 'vendor system ID (primary key)'
    },
    number: {
        type: 'string',
        required: true,
        description: 'vendor defect number (e.g., DEF0707437)'
    },
    
    // Convenience fields for our AI system (added by normalization)
    _id: {
        type: 'string',
        description: 'Alias for sys_id for easier querying'
    },
    _title: {
        type: 'string',
        description: 'Searchable title extracted from vendor fields'
    },
    _searchText: {
        type: 'string',
        description: 'Combined text from all relevant vendor fields for vector search'
    },
    _imported_at: {
        type: 'date',
        description: 'When this record was imported into our system'
    },
    _last_updated: {
        type: 'date',
        description: 'When this record was last updated in our system'
    },
    
    // ALL OTHER FIELDS: Store as-is from vendor response
    // This is a flexible schema that accepts any vendor field
    // Common fields based on your sample data:
    
    // Core vendor fields (examples - all others will be stored as-is)
    short_description: { type: 'string' },
    description: { type: 'string' },
    html_description: { type: 'string' },
    task: { type: 'string' },
    steps_to_reproduce: { type: 'string' },
    state: { type: 'string' },
    severity: { type: 'string' },
    priority: { type: 'string' },
    impact: { type: 'string' },
    urgency: { type: 'string' },
    active: { type: 'string' },
    defect_type: { type: 'string' },
    classification: { type: 'string' },
    
    // Assignment fields (can be objects or strings)
    opened_by: { type: 'mixed' },
    assigned_to: { type: 'mixed' },
    assignment_group: { type: 'mixed' },
    
    // Product/Service fields
    u_product_service: { type: 'mixed' },
    product: { type: 'string' },
    release: { type: 'string' },
    
    // Dates (all as strings from vendor)
    sys_created_on: { type: 'string' },
    sys_updated_on: { type: 'string' },
    opened_at: { type: 'string' },
    closed_at: { type: 'string' },
    due_date: { type: 'string' },
    start_date: { type: 'string' },
    end_date: { type: 'string' },
    
    // System fields
    sys_class_name: { type: 'string' },
    sys_mod_count: { type: 'string' },
    sys_created_by: { type: 'string' },
    sys_updated_by: { type: 'string' },
    sys_domain: { type: 'mixed' },
    
    // Note: This schema is intentionally flexible
    // Any additional vendor fields will be stored as-is
    // This ensures we never lose data and makes integration much easier
};

const testCaseSchema = {
    // SIMPLIFIED SCHEMA: Store Native vendor Test Case Data with Minimal Transformation
    // This approach preserves all original vendor test case fields exactly as received
    // making testing, matching, and integration much easier
    
    // Core vendor identifiers (required)
    sys_id: {
        type: 'string',
        required: true,
        description: 'vendor test case system ID (primary key)'
    },
    number: {
        type: 'string',
        required: true,
        description: 'vendor test case number (e.g., TNTC0514703)'
    },
    
    // Convenience fields for our AI system (added by normalization)
    _id: {
        type: 'string',
        description: 'Alias for sys_id for easier querying'
    },
    _title: {
        type: 'string',
        description: 'Searchable title extracted from vendor test case fields'
    },
    _searchText: {
        type: 'string',
        description: 'Combined text from all relevant vendor test case fields for vector search'
    },
    _imported_at: {
        type: 'date',
        description: 'When this test case record was imported into our system'
    },
    _last_updated: {
        type: 'date',
        description: 'When this test case record was last updated in our system'
    },
    
    // Vector embedding for similarity search (AI system field)
    embedding: {
        type: 'array',
        items: { type: 'number' },
        description: 'Vector embedding for similarity search'
    },
    
    // ALL OTHER FIELDS: Store as-is from vendor test case response
    // This is a flexible schema that accepts any vendor test case field
    // Common fields based on your sample data:
    
    // Core test case fields (examples - all others will be stored as-is)
    short_description: { type: 'string' },
    steps: { type: 'string' }, // HTML content with test steps
    prerequisites: { type: 'string' },
    reason: { type: 'string' },
    
    // Test execution and automation fields
    automation_status: { type: 'string' },
    automation_priority: { type: 'string' },
    automated_test_method: { type: 'string' },
    automated_by: { type: 'string' },
    automated_on: { type: 'string' },
    estimated_automation_effort: { type: 'string' },
    estimated_manual_effort: { type: 'string' },
    script_name: { type: 'string' },
    use_default_steps_template: { type: 'string' },
    
    // Assignment and ownership (can be objects or strings)
    assigned_to: { type: 'mixed' },
    owner: { type: 'mixed' },
    assignment_group: { type: 'mixed' },
    
    // Test organization and hierarchy
    parent: { type: 'mixed' },
    order: { type: 'string' },
    priority: { type: 'string' },
    
    // Product and service references
    product_service: { type: 'mixed' },
    product_category: { type: 'string' },
    
    // Test classification and metadata
    test_types: { type: 'string' },
    facet: { type: 'string' },
    
    // Release and environment management
    supported_releases: { type: 'string' },
    active_releases: { type: 'string' },
    lab_infrastruture: { type: 'mixed' },
    
    // External system integration
    tm2_test_ref: { type: 'string' },
    tm2_test_number: { type: 'string' },
    created_for_task: { type: 'string' },
    created_from: { type: 'string' },
    
    // AI and generation metadata
    genai_generated: { type: 'string' },
    
    // Approval and workflow
    peer_approval_status: { type: 'string' },
    work_notes: { type: 'string' },
    
    // System fields (all as strings from vendor)
    sys_created_on: { type: 'string' },
    sys_updated_on: { type: 'string' },
    sys_created_by: { type: 'string' },
    sys_updated_by: { type: 'string' },
    sys_mod_count: { type: 'string' },
    sys_tags: { type: 'string' },
    
    // Note: This schema is intentionally flexible
    // Any additional vendor test case fields will be stored as-is
    // This ensures we never lose data and makes integration much easier
};

const rcaSchema = {
    // SIMPLIFIED SCHEMA: Store Native vendor RCA Data with Minimal Transformation
    // This approach preserves all original vendor RCA fields exactly as received
    // making testing, matching, and integration much easier
    
    // Core vendor identifiers (required)
    sys_id: {
        type: 'string',
        required: true,
        description: 'vendor RCA system ID (primary key)'
    },
    u_number: {
        type: 'string',
        required: true,
        description: 'vendor RCA number (e.g., RCA0007708)'
    },
    
    // Convenience fields for our AI system (added by normalization)
    _id: {
        type: 'string',
        description: 'Alias for sys_id for easier querying'
    },
    _title: {
        type: 'string',
        description: 'Searchable title extracted from vendor RCA fields'
    },
    _searchText: {
        type: 'string',
        description: 'Combined text from all relevant vendor RCA fields for vector search'
    },
    _imported_at: {
        type: 'date',
        description: 'When this RCA record was imported into our system'
    },
    _last_updated: {
        type: 'date',
        description: 'When this RCA record was last updated in our system'
    },
    
    // ALL OTHER FIELDS: Store as-is from vendor RCA response
    // This is a flexible schema that accepts any vendor RCA field
    // Common fields based on your sample data:
    
    // Core RCA fields (examples - all others will be stored as-is)
    defect_short_description: { type: 'string' },
    u_description: { type: 'string' },
    u_state: { type: 'string' },
    u_rca_type: { type: 'string' },
    u_rca_number: { type: 'string' },
    u_notes: { type: 'string' },
    
    // Defect and Product References (can be objects or strings)
    u_defect: { type: 'mixed' },
    u_product: { type: 'string' },
    u_product_service: { type: 'mixed' },
    release: { type: 'mixed' },
    
    // Test Coverage and Quality Fields
    test_coverage_gap: { type: 'string' },
    test_cases: { type: 'string' },
    u_could_a_unit_test_have_caught_this_defect: { type: 'string' },
    u_missing_type_of_a_test_that_would_have_caught_this_defect: { type: 'string' },
    u_missing_test_facet_that_would_have_caught_this_defect: { type: 'string' },
    testing_issue_which_test_types_are_involved: { type: 'string' },
    
    // RCA Process and Analysis Fields
    how_was_the_issue_found: { type: 'string' },
    u_how_was_the_issue_discovered: { type: 'string' },
    u_how_was_the_issue_introduced: { type: 'string' },
    which_instance_was_the_issue_found_on: { type: 'string' },
    other_how_was_issue_found: { type: 'string' },
    other_instance: { type: 'string' },
    other: { type: 'string' },
    
    // Prevention and Process Improvement
    u_how_to_prevent_detect_the_issue: { type: 'string' },
    u_how_are_you_going_to_fill_the_process_or_coverage_gap: { type: 'string' },
    u_areas_of_the_development_process_are_involved_in_this_defect: { type: 'string' },
    u_defect_cause_classification: { type: 'string' },
    u_caused_by: { type: 'string' },
    u_product_category: { type: 'string' },
    
    // Important Dates
    u_date_introduced: { type: 'string' },
    u_date_discovered: { type: 'string' },
    
    // Assignment and Ownership (can be objects or strings)
    rca_owner: { type: 'mixed' },
    u_assignment_group: { type: 'mixed' },
    u_qe_bu_owner: { type: 'mixed' },
    
    // System fields (all as strings from vendor)
    sys_created_on: { type: 'string' },
    sys_updated_on: { type: 'string' },
    sys_created_by: { type: 'string' },
    sys_updated_by: { type: 'string' },
    sys_mod_count: { type: 'string' },
    sys_tags: { type: 'string' },
    
    // Monitoring and Tracking
    watch_list: { type: 'string' },
    
    // Note: This schema is intentionally flexible
    // Any additional vendor RCA fields will be stored as-is
    // This ensures we never lose data and makes integration much easier
};

// Many-to-Many Mapping Schemas - Native vendor Format
const defectTestCaseMappingSchema = {
    // SIMPLIFIED SCHEMA: Store Native vendor Mapping Data with Minimal Transformation
    // This approach preserves all original vendor mapping fields exactly as received
    // Based on x_snc_test_now_m2m_test_cases_tasks table structure
    
    // Core vendor identifiers (required)
    sys_id: {
        type: 'string',
        required: true,
        description: 'vendor mapping system ID (primary key)'
    },
    
    // Convenience fields for our AI system (added by normalization)
    _id: {
        type: 'string',
        description: 'Alias for sys_id for easier querying'
    },
    _imported_at: {
        type: 'date',
        description: 'When this mapping record was imported into our system'
    },
    _last_updated: {
        type: 'date',
        description: 'When this mapping record was last updated in our system'
    },
    
    // Core mapping relationship fields from vendor
    task: {
        type: 'mixed',
        required: true,
        description: 'vendor reference object pointing to the task/defect'
    },
    test_case: {
        type: 'mixed',
        required: true,
        description: 'vendor reference object pointing to the test case'
    },
    
    // System fields (all as strings from vendor)
    sys_created_on: { type: 'string' },
    sys_updated_on: { type: 'string' },
    sys_created_by: { type: 'string' },
    sys_updated_by: { type: 'string' },
    sys_mod_count: { type: 'string' },
    sys_tags: { type: 'string' },
    
    // AI system enhancement fields (optional)
    _similarity_score: {
        type: 'number',
        description: 'AI-calculated similarity score between defect and test case'
    },
    _confidence_level: {
        type: 'string',
        description: 'AI confidence level in this mapping'
    },
    _mapping_type: {
        type: 'string',
        description: 'AI-determined relationship type (covers, reproduces, validates-fix)'
    },
    
    // Note: This schema is intentionally flexible
    // Any additional vendor mapping fields will be stored as-is
    // This ensures we never lose data and makes integration much easier
};

// Additional schemas for system functionality
const embeddingMetadataSchema = {
    id: {
        type: 'string',
        required: true
    },
    entityType: {
        type: 'string',
        enum: ['test-case', 'defect'],
        required: true
    },
    entityId: {
        type: 'string',
        required: true
    },
    embeddingModel: {
        type: 'string',
        required: true
    },
    embeddingVersion: {
        type: 'string',
        required: true
    },
    createdAt: {
        type: 'date',
        default: 'now'
    }
};

module.exports = {
    defectSchema,
    testCaseSchema,
    rcaSchema,
    defectTestCaseMappingSchema,
    embeddingMetadataSchema
};
