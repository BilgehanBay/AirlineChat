const axios = require('axios');

// Set API base URL based on environment
const API_BASE_URL = process.env.API_BASE_URL || 'https://airlineticketing-system.azurewebsites.net';

const QUERY_FLIGHT_API = process.env.QUERY_FLIGHT_API;
const BUY_TICKET_API = process.env.BUY_TICKET_API;
const CHECK_IN_API = process.env.CHECK_IN_API;

console.log('API Configuration:');
console.log(`- Base URL: ${API_BASE_URL}`);
console.log(`- Flight API: ${QUERY_FLIGHT_API}`);
console.log(`- Ticket API: ${BUY_TICKET_API}`);
console.log(`- Check-in API: ${CHECK_IN_API}`);

// Configure axios with timeout and headers
const apiClient = axios.create({
  timeout: 10000, // 10 seconds timeout
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// Authentication token storage
let authToken = null;
let tokenExpiry = null;

// Adapters for connecting to existing APIs
class ApiAdapters {
  // Ensure authentication before making secured requests
  static async ensureAuthenticated() {
    // If we have a valid token that's not expired, use it
    if (authToken && tokenExpiry && new Date() < tokenExpiry) {
      console.log('Using existing auth token');
      return true;
    }
    
    // Otherwise try to login
    try {
      console.log('Getting new auth token');
      const credentials = {
        username: process.env.API_USERNAME,
        password: process.env.API_PASSWORD
      };
      
      const response = await axios.post(`${API_BASE_URL}/api/v1/Auth/login`, credentials);
      
      if (response.data && response.data.token) {
        authToken = response.data.token;
        // Set expiry to 1 hour from now
        tokenExpiry = new Date(new Date().getTime() + 60 * 60 * 1000);
        
        // Set the auth header for future requests
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
        console.log('Authentication successful');
        return true;
      } else {
        console.error('Auth response missing token');
        return false;
      }
    } catch (error) {
      console.error('Authentication failed:', error.message);
      if (error.response) {
        console.error('Auth response status:', error.response.status);
        console.error('Auth response data:', error.response.data);
      }
      return false;
    }
  }

  // Flight search adapter
  static async searchFlights(params) {
    try {
      console.log(`Searching flights with params:`, params);
      
      // Format parameters to match the API requirements based on Swagger documentation
      const apiParams = {
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        airportFrom: params.origin,
        airportTo: params.destination,
        numberOfPeople: parseInt(params.passengers, 10)
      };
      
      console.log(`Formatted API params:`, apiParams);
      console.log(`Sending request to: ${QUERY_FLIGHT_API}`);
      
      // Using GET for flight search as per the API documentation
      const response = await apiClient.get(QUERY_FLIGHT_API, { 
        params: apiParams,
        timeout: 150000 // Extended timeout for network issues
      });
      console.log('Flight search response status:', response.status);
      return response.data;
    } catch (error) {
      console.error('Error searching flights:', error.message);
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        console.error('Connection failed - API server might be down or unreachable');
      } else if (error.code === 'ETIMEDOUT') {
        console.error('Connection timed out - API server might be overloaded');
      }
      
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      
      throw new Error(`Failed to search flights: ${error.message}`);
    }
  }

  // Ticket booking adapter
  static async bookTicket(ticketData) {
    try {
      // Ensure we're authenticated before booking
      await this.ensureAuthenticated();
      
      console.log(`Booking ticket with data:`, ticketData);
      
      // Don't override the input data with hardcoded values
      const flightNumber = ticketData.flightNumber;
      const flightDate = ticketData.flightDate;
      // Handle passenger names as string or array
      const passengerNames = Array.isArray(ticketData.passengerNames) 
        ? ticketData.passengerNames 
        : [ticketData.passengerNames || ticketData.passengerName].filter(Boolean);
      
      console.log(`Using date for booking: ${flightDate}`);
      
      // Format the ticket data to match the API requirements with proper casing
      const apiTicketData = {
        flightNumber: flightNumber,
        flightDate: flightDate,
        passengerNames: passengerNames
      };
      
      console.log(`Formatted API ticket data:`, apiTicketData);
      
      // Using POST for ticket booking as per the API documentation
      const response = await apiClient.post(BUY_TICKET_API, apiTicketData);
      console.log('Ticket booking response status:', response.status);
      console.log('Ticket booking response data:', JSON.stringify(response.data));
      
      // Just return the original response data to preserve the structure
      return {
        ...response.data,
        status: 'success',
        statusCode: response.status
      };
    } catch (error) {
      console.error('Error booking ticket:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data || {}));
        
        // Return the API error data for the AI to interpret
        return {
          error: true,
          statusCode: error.response.status,
          errorData: error.response.data,
          message: error.response?.data?.errors 
            ? `${JSON.stringify(error.response.data.errors)}` 
            : 'Failed to book ticket. Please try again with valid flight details.'
        };
      }
      
      // For network or other errors
      return {
        error: true,
        message: error.message,
        status: 'failed'
      };
    }
  }

  // Check-in adapter
  static async checkIn(checkInData) {
    try {
      // Ensure we're authenticated before check-in
      await this.ensureAuthenticated();
      
      console.log(`Checking in with data:`, checkInData);
      
      // Format check-in data to match the API requirements
      const apiCheckInData = {
        flightNumber: checkInData?.flightNumber,
        date: checkInData?.date, 
        passengerName: checkInData?.passengerName
      };
      
      console.log(`Formatted API check-in data:`, apiCheckInData);
      
      // Using POST for check-in as per the API documentation
      const response = await apiClient.post(CHECK_IN_API, apiCheckInData);
      console.log('Check-in response status:', response.status);
      console.log('Check-in response data:', JSON.stringify(response.data));
      
      // Just return the original response data to preserve the structure
      return {
        ...response.data,
        status: 'success',
        statusCode: response.status
      };
    } catch (error) {
      console.error('Error checking in:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data || {}));
        
        // Return the API error data for the AI to interpret
        return {
          error: true,
          statusCode: error.response.status,
          errorData: error.response.data,
          message: error.response?.data?.errors 
            ? `${JSON.stringify(error.response.data.errors)}` 
            : 'Failed to check in. Please verify your flight details and try again.'
        };
      }
      
      // For network or other errors
      return {
        error: true,
        message: error.message,
        status: 'failed'
      };
    }
  }

  // Handle authentication if needed
  static async login(credentials) {
    try {
      console.log('Attempting to login...');
      const response = await axios.post(`${API_BASE_URL}/api/v1/Auth/login`, credentials);
      console.log('Login response:', response.status);
      
      // Store the token for subsequent requests
      if (response.data && response.data.token) {
        authToken = response.data.token;
        tokenExpiry = new Date(new Date().getTime() + 60 * 60 * 1000);
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
      }
      
      return response.data;
    } catch (error) {
      console.error('Error logging in:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw new Error('Failed to login');
    }
  }
}

module.exports = ApiAdapters; 