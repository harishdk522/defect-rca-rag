const axios = require('axios');
const { createServiceLogger } = require('../config/logger');

class ExternalApiService {
    constructor() {
        this.logger = createServiceLogger('ExternalApiService');
        this.baseUrl = process.env.EXTERNAL_API_BASE_URL;
        this.clientId = process.env.EXTERNAL_CLIENT_ID;
        this.clientSecret = process.env.EXTERNAL_CLIENT_SECRET;
        this.grantType = process.env.EXTERNAL_GRANT_TYPE;
        this.timeout = parseInt(process.env.EXTERNAL_API_TIMEOUT) || 30000;

        // OAuth token management
        this.accessToken = null;
        this.tokenExpiry = null;
        this.tokenBuffer = 60000; // Refresh token 1 minute before expiry

        // vendor table endpoints
        this.endpoints = {
            defects: '/api/now/table/x_snc_defect_defect',
            testCases: '/api/now/table/x_snc_test_now_test_case',
            rca: '/api/now/table/u_rca',
            defectTestCaseMappings: '/api/now/table/x_snc_test_now_m2m_test_cases_tasks'
        };

        // Create axios instance for OAuth requests
        this.oauthClient = axios.create({
            timeout: this.timeout,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'DefectAutomationSystem/1.0'
            }
        });

        // Create axios instance for API requests
        this.apiClient = axios.create({
            baseURL: this.baseUrl,
            timeout: this.timeout,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'DefectAutomationSystem/1.0',
                'Accept': 'application/json'
            }
        });
    }

    async _getOAuthToken() {
        try {
            // Check if current token is still valid
            if (this.accessToken && this.tokenExpiry &&
                Date.now() < (this.tokenExpiry - this.tokenBuffer)) {
                this.logger.debug('Using cached OAuth token');
                return this.accessToken;
            }

            this.logger.info('Requesting new OAuth token from vendor...');

            const tokenUrl = `${this.baseUrl}/oauth_token.do`;
            const params = new URLSearchParams({
                grant_type: this.grantType,
                client_id: this.clientId,
                client_secret: this.clientSecret
            });

            const response = await this.oauthClient.post(tokenUrl, params.toString());

            if (response.status === 200 && response.data.access_token) {
                this.accessToken = response.data.access_token;
                this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

                this.logger.info('OAuth token obtained successfully', {
                    expires_in: response.data.expires_in,
                    token_type: response.data.token_type
                });

                return this.accessToken;
            } else {
                throw new Error(`OAuth token request failed: ${response.status}`);
            }

        } catch (error) {
            this.logger.error('Failed to obtain OAuth token:', {
                error: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            throw new Error(`OAuth authentication failed: ${error.message}`);
        }
    }

    async _makeAuthenticatedRequest(method, endpoint, data = null, params = null) {
        try {
            // Get valid OAuth token
            const token = await this._getOAuthToken();

            // Configure request with authentication
            const config = {
                method,
                url: endpoint,
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            };

            if (data) {
                config.data = data;
            }

            if (params) {
                config.params = params;
            }

            // Make the authenticated request
            const response = await this.apiClient.request(config);
            return response;

        } catch (error) {
            // If token expired, clear it and retry once
            if (error.response?.status === 401 && this.accessToken) {
                this.logger.warn('OAuth token expired, clearing cache and retrying...');
                this.accessToken = null;
                this.tokenExpiry = null;

                // Retry once with fresh token
                const token = await this._getOAuthToken();
                const retryConfig = {
                    method,
                    url: endpoint,
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                };

                if (data) retryConfig.data = data;
                if (params) retryConfig.params = params;

                return await this.apiClient.request(retryConfig);
            }

            throw error;
        }
    }

    async getDefectDetails(defectNumber, fetchDisplayValue = false) {
        try {
            this.logger.info(`Fetching defect details for: ${defectNumber}`);

            const response = await this._makeAuthenticatedRequest(
                'GET',
                this.endpoints.defects,
                null,
                {
                    sysparm_query: `number=${defectNumber}`,
                    sysparm_display_value: fetchDisplayValue
                }
            );

            if (response.status === 200 && response.data.result && response.data.result.length > 0) {
                this.logger.info(`Successfully fetched defect: ${defectNumber}`);
                return response.data.result[0];
            } else if (response.data.result && response.data.result.length === 0) {
                throw new Error(`Defect ${defectNumber} not found`);
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }
        } catch (error) {
            this.logger.error(`Failed to fetch defect ${defectNumber}:`, {
                error: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText
            });

            if (error.response?.status === 404) {
                throw new Error(`Defect ${defectNumber} not found`);
            } else if (error.response?.status === 401) {
                throw new Error('Unauthorized: Invalid OAuth token');
            } else if (error.response?.status === 403) {
                throw new Error('Forbidden: Insufficient permissions');
            }

            throw error;
        }
    }

    async searchTestCases(searchCriteria) {
        try {
            this.logger.info('Searching for test cases with criteria:', searchCriteria);

            // Build vendor query
            const queryParts = [];
            if (searchCriteria.sys_created_on) queryParts.push(`sys_created_on>=${searchCriteria.sys_created_on}`);

            // Add ordering for consistent data retrieval (newest first)
            const orderBy = searchCriteria.orderBy || 'ORDERBYDESCsys_created_on';
            if (queryParts.length > 0) {
                queryParts.push(orderBy);
            }

            const query = queryParts.length > 0 ? queryParts.join('^') : orderBy;

            const params = {
                sysparm_query: query,
                sysparm_limit: searchCriteria.limit || 50,
                sysparm_offset: searchCriteria.offset || 0
            };

            const response = await this._makeAuthenticatedRequest(
                'GET',
                this.endpoints.testCases,
                null,
                params
            );

            if (response.status === 200) {
                const testCases = response.data.result || [];
                return {
                    testCases: testCases,
                    total: testCases.length,
                    hasMore: testCases.length === (searchCriteria.limit || 50)
                };
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }
        } catch (error) {
            this.logger.error('Failed to search test cases:', {
                error: error.message,
                criteria: searchCriteria,
                status: error.response?.status
            });
            throw error;
        }
    }

    async getTestCaseDetails(testCaseId) {
        try {
            this.logger.info(`Fetching test case details for: ${testCaseId}`);

            const response = await this._makeAuthenticatedRequest(
                'GET',
                this.endpoints.testCases,
                null,
                { sysparm_query: `sys_id=${testCaseId}`, sysparm_display_value: true }
            );

            if (response.status === 200 && response.data.result && response.data.result.length > 0) {
                this.logger.info(`Successfully fetched test case: ${testCaseId}`);
                return response.data.result[0];
            } else {
                throw new Error(`Test case ${testCaseId} not found`);
            }
        } catch (error) {
            this.logger.error(`Failed to fetch test case ${testCaseId}:`, error);
            throw error;
        }
    }

    async getDefectTestCaseMappings(defectId, defectNumber) {
        try {
            this.logger.info(`Fetching test case mappings for defect: ${defectNumber}`);

            // Query the mapping table for entries with this defect ID
            const query = `task=${defectId}`;
            const params = {
                sysparm_query: query,
                sysparm_limit: 10
            };

            const response = await this._makeAuthenticatedRequest(
                'GET',
                this.endpoints.defectTestCaseMappings,
                null,
                params
            );

            if (response.status === 200) {
                const mappings = response.data.result || [];
                this.logger.info(`Found ${mappings.length} test case mappings for defect ${defectNumber}`);
                
                // Normalize the mapping data
                return mappings.map(mapping => {
                    return {
                        sys_id: mapping.sys_id,
                        test_case: mapping.test_case.value,
                        task: mapping.task.value,
                        created_by: mapping.sys_created_by
                    };
                });
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }
        } catch (error) {
            this.logger.error(`Failed to fetch mappings for defect ${defectNumber}:`, error);
            // Return empty array instead of throwing to allow graceful fallback to RAG search
            return [];
        }
    }

    async createTestCase(testCaseData, testCaseId) {
        try {
            this.logger.info(`Creating test case: ${testCaseId}`);

            const response = await this._makeAuthenticatedRequest(
                'POST',
                this.endpoints.testCases,
                testCaseData
            );

            if (response.status === 201 || response.status === 200) {
                this.logger.info(`Successfully created test case for id: ${testCaseId} to sys_id: ${response.data.result.sys_id} and number: ${response.data.result.number}`);
                return response.data.result;
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }
        } catch (error) {
            this.logger.error('Failed to create test case:', {
                error: error.message,
                title: testCaseData.title,
                status: error.response?.status
            });
            throw error;
        }
    }

    async createDefectTestCaseMapping(defectId, testCaseId) {
        try {
            this.logger.info(`Creating mapping between defect ${defectId} and test case ${testCaseId}`);

            const payload = {
                task: defectId,      // Reference to the defect/task
                test_case: testCaseId // Reference to the test case
            };

            const response = await this._makeAuthenticatedRequest(
                'POST',
                this.endpoints.defectTestCaseMappings,
                payload
            );

            if (response.status === 201 || response.status === 200) {
                this.logger.info(`Successfully created mapping: ${response.data.result.sys_id}`);
                return response.data.result;
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }
        } catch (error) {
            this.logger.error('Failed to create defect-testcase mapping:', {
                error: error.message,
                defectId,
                testCaseId,
                status: error.response?.status
            });
            throw error;
        }
    }

    async createRCA(defectDetails) {
        try {
            this.logger.info(`Creating RCA for defect: ${defectDetails.number}`);

            const payload = this._prepareRCAPayload(defectDetails);
            const response = await this._makeAuthenticatedRequest(
                'POST',
                this.endpoints.rca,
                payload
            );

            if (response.status === 201 || response.status === 200) {
                const createdRCA = response.data.result;
                this.logger.info(`Successfully created RCA: ${createdRCA.u_number}`);
                return createdRCA;
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }
        } catch (error) {
            this.logger.error('Failed to create RCA:', {
                error: error.message,
                defectNumber: defectDetails.number,
                status: error.response?.status
            });
            throw error;
        }
    }

    async getTestCaseListDetails(similarTestCases) {
        try {
            const testCaseIds = similarTestCases.filter(tc => tc.sys_created_by !== 'AI-System').map(tc => tc.sys_id);

            this.logger.info(`Fetching test case details for ${testCaseIds.length} similar test cases`);
            
            if (testCaseIds.length === 0) {
                this.logger.info(`No similar test case details to fetch`);
                return similarTestCases;
            }

            const params = {
                sysparm_query: `sys_idIN${testCaseIds.join(',')}`,
                sysparm_limit: 10
            };

            const response = await this._makeAuthenticatedRequest(
                'GET',
                this.endpoints.testCases,
                null,
                params
            );

            if (response.status === 200) {
                const testCases = response.data.result || [];
                this.logger.info(`Found ${testCases.length} test case details`);

                // Normalize the test case data
                return similarTestCases.map(tc => {
                    const testCase = testCases.find(tc => tc.sys_id === tc.sys_id);
                    return testCase ? {
                        ...testCase,
                        similarityAnalysis: tc.similarityAnalysis
                    } : tc;
                });
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }
        } catch (error) {
            this.logger.error('Failed to fetch test case details:', error);
            // Return empty array instead of throwing to allow graceful fallback to RAG search
            return similarTestCases;
        }
    }

    // Utility method for safely filtering and joining text parts to avoid 'trim is not a function' errors
    _safeFilterTextParts(textParts) {
        return textParts
            .filter(part => {
                // Check if part is a string first
                if (typeof part === 'string') {
                    return part.trim().length > 0;
                }
                // If not a string but truthy, convert to string
                return part ? String(part).trim().length > 0 : false;
            })
            .map(part => typeof part === 'string' ? part : String(part))
            .join(' ')
            .trim();
    }

    _prepareRCAPayload(defectDetails) {
        return {
            u_defect: defectDetails.sys_id,
            defect_short_description: defectDetails.short_description,
            release: defectDetails.u_target_version.value,
            u_product_service: defectDetails.u_product_service.value,
            u_product_category: defectDetails.u_product_category.value,
            u_assignment_group: defectDetails.assignment_group.value,
            u_state: 'Draft',
            u_rca_type: 'Release Candidates',
            u_how_was_the_issue_introduced: 'Should automate this',
            how_was_the_issue_found: 'Manual',
            u_how_to_prevent_detect_the_issue: 'no'
        };
    }

    _formatTestSteps(testSteps) {
        return testSteps.map((step, index) =>
            `Step ${index + 1}: ${step.step} - Expected: ${step.expectedResult}`
        ).join('\n');
    }

    
    async updateDefectWithRCAs(defectSysId, rcaSysId) {
        const params = {
            u_rca: rcaSysId
        };

        try {
            const response = await this._makeAuthenticatedRequest(
                'PATCH',
                this.endpoints.defects + '/' + defectSysId,
                params
            );

            if (response.status === 200) {
                this.logger.info(`Successfully updated defect ${defectSysId} with RAC: ${rcaSysId}`);
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }
            return response.data.result;
        } catch (error) {
            this.logger.error(`Failed to update defect ${defectSysId} with RAC: ${error}`);
            // Throw error to propagate the error
            throw error;
        }
    }


    async healthCheck() {
        try {
            // Test OAuth token retrieval
            const token = await this._getOAuthToken();

            // Test basic API connectivity
            const response = await this._makeAuthenticatedRequest(
                'GET',
                this.endpoints.defects,
                null,
                { sysparm_limit: 1 }
            );

            return {
                status: 'up',
                oauth: token ? 'authenticated' : 'failed',
                api: response.status === 200 ? 'accessible' : 'down',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error('Health check failed:', error);
            return {
                status: 'down',
                oauth: 'failed',
                api: 'down',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = ExternalApiService;
