const { CosmosClient } = require('@azure/cosmos');

class CosmosDbService {
  constructor(config) {
    // Log environment variables for debugging
    console.log('Cosmos DB Environment Variables:');
    console.log(`- COSMOS_ENDPOINT: ${process.env.COSMOS_ENDPOINT ? 'Set' : 'Not set'}`);
    console.log(`- COSMOS_KEY: ${process.env.COSMOS_KEY ? 'Set (Length: ' + process.env.COSMOS_KEY.length + ')' : 'Not set'}`);
    console.log(`- COSMOS_DATABASE: ${process.env.COSMOS_DATABASE || 'Not set, using default: AirlineChatDB'}`);
    console.log(`- COSMOS_CONTAINER: ${process.env.COSMOS_CONTAINER || 'Not set, using default: ChatMessages'}`);
    
    this.config = config || {
      endpoint: process.env.COSMOS_ENDPOINT,
      key: process.env.COSMOS_KEY,
      databaseId: process.env.COSMOS_DATABASE || 'AirlineChatDB',
      containerId: process.env.COSMOS_CONTAINER || 'ChatMessages'
    };
    
    // Check if the required configuration is available
    if (!this.config.endpoint || !this.config.key) {
      console.warn('Missing Cosmos DB configuration - will use in-memory storage instead');
      console.warn('To use Cosmos DB, please set COSMOS_ENDPOINT and COSMOS_KEY environment variables');
      this.client = null;
      return;
    }
    
    try {
      this.client = new CosmosClient({
        endpoint: this.config.endpoint,
        key: this.config.key
      });
      console.log('Cosmos DB client created successfully');
    } catch (error) {
      console.error('Error creating Cosmos DB client:', error);
      console.warn('Will use in-memory storage instead');
      this.client = null;
    }
    
    this.database = null;
    this.container = null;
  }

  async initialize() {
    if (!this.client) {
      console.error('Cannot initialize: Cosmos DB client is not created');
      return false;
    }
    
    try {
      console.log('Attempting to connect to Cosmos DB...');
      console.log(`Database ID: ${this.config.databaseId}`);
      console.log(`Container ID: ${this.config.containerId}`);
      console.log(`Endpoint: ${this.config.endpoint.substring(0, 30)}...`);
      
      // Test the connection first
      try {
        console.log('Testing connection to Cosmos DB...');
        await this.client.getDatabaseAccount();
        console.log('Connection test successful!');
      } catch (connectionError) {
        console.error('Connection test failed:', connectionError.message);
        if (connectionError.code === 'Unauthorized') {
          console.error('Unauthorized: The provided key is invalid or has expired');
        } else if (connectionError.code === 'NotFound') {
          console.error('NotFound: The Cosmos DB account does not exist');
        } else if (connectionError.code === 'ENOTFOUND') {
          console.error('ENOTFOUND: The endpoint hostname cannot be resolved. Check the endpoint value.');
        }
        return false;
      }
      
      // Check if the database exists
      const { database } = await this.client.databases.createIfNotExists({
        id: this.config.databaseId
      });
      this.database = database;
      console.log(`Database '${this.config.databaseId}' connected/created successfully`);
      
      // Check if the container exists
      const { container } = await this.database.containers.createIfNotExists({
        id: this.config.containerId,
        partitionKey: { paths: ["/userId"] }
      });
      this.container = container;
      console.log(`Container '${this.config.containerId}' connected/created successfully`);
      
      // Test write permission with a test document
      try {
        console.log('Testing write permission with a test document...');
        const testDoc = {
          id: `test-${Date.now()}`,
          type: 'test',
          message: 'Test connection document',
          timestamp: new Date().toISOString()
        };
        
        const { resource: createdItem } = await this.container.items.create(testDoc);
        console.log('Test document created successfully with id:', createdItem.id);
        
        // Try to delete the test document to clean up
        try {
          await this.container.item(createdItem.id).delete();
          console.log('Test document deleted successfully');
        } catch (deleteError) {
          console.warn('Could not delete test document, but write permission is confirmed:', deleteError.message);
        }
      } catch (writeError) {
        console.error('Failed to create test document - write permission issue:');
        console.error('- Error Name:', writeError.name);
        console.error('- Error Message:', writeError.message);
        console.error('- Error Code:', writeError.code);
        return false;
      }
      
      console.log('Connected to Azure Cosmos DB');
      return true;
    } catch (error) {
      console.error('Error initializing Cosmos DB connection:');
      console.error('- Error Name:', error.name);
      console.error('- Error Message:', error.message);
      console.error('- Error Code:', error.code);
      
      if (error.code === 'NotFound') {
        console.error('The database or container was not found. Please make sure they exist.');
      } else if (error.code === 'Unauthorized') {
        console.error('Invalid credentials. Please check your Cosmos DB key.');
      }
      
      return false;
    }
  }

  async saveMessage(message) {
    if (!this.container) {
      console.warn('Cosmos DB container not initialized');
      return null;
    }
    
    try {
      console.log('Attempting to save message to Cosmos DB:', JSON.stringify({
        id: message.id,
        sender: message.sender, 
        userId: message.userId
      }));
      const { resource: createdItem } = await this.container.items.create(message);
      console.log('Message successfully saved to Cosmos DB with id:', createdItem.id);
      return createdItem;
    } catch (error) {
      console.error('Error saving message to Cosmos DB:');
      console.error('- Error Name:', error.name);
      console.error('- Error Message:', error.message);
      console.error('- Error Code:', error.code);
      
      if (error.code === 'NotFound') {
        console.error('The database or container was not found. Please check container/database existence.');
      } else if (error.code === 'Unauthorized') {
        console.error('Unauthorized: Insufficient permissions to create documents.');
      } else if (error.code === 'PartitionKeyMismatch') {
        console.error('Partition key issue: The message partition key doesn\'t match container definition.');
      }
      
      return null;
    }
  }

  async getConversationHistory(userId, limit = 20) {
    if (!this.container) {
      console.warn('Cosmos DB container not initialized');
      return [];
    }
    
    try {
      const querySpec = {
        query: 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit',
        parameters: [
          {
            name: '@userId',
            value: userId
          },
          {
            name: '@limit',
            value: limit
          }
        ]
      };
      
      const { resources: items } = await this.container.items.query(querySpec).fetchAll();
      return items.reverse(); // Return in chronological order
    } catch (error) {
      console.error('Error retrieving conversation history from Cosmos DB:', error);
      return [];
    }
  }

  async deleteConversationHistory(userId) {
    if (!this.container) {
      console.warn('Cosmos DB container not initialized');
      return false;
    }
    
    try {
      console.log(`Deleting conversation history for user: ${userId}`);
      
      // Query to find all messages for this user
      const querySpec = {
        query: 'SELECT c.id FROM c WHERE c.userId = @userId',
        parameters: [
          {
            name: '@userId',
            value: userId
          }
        ]
      };
      
      const { resources: items } = await this.container.items.query(querySpec).fetchAll();
      console.log(`Found ${items.length} messages to delete for user ${userId}`);
      
      // Delete each message
      const deletePromises = items.map(item => 
        this.container.item(item.id, userId).delete()
      );
      
      await Promise.allSettled(deletePromises);
      console.log(`Successfully deleted conversation history for user ${userId}`);
      
      return true;
    } catch (error) {
      console.error('Error deleting conversation history from Cosmos DB:', error);
      console.error('- Error Name:', error.name);
      console.error('- Error Message:', error.message);
      console.error('- Error Code:', error.code);
      return false;
    }
  }
}

module.exports = CosmosDbService; 