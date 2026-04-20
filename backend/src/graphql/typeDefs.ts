export const typeDefs = `#graphql
  type User {
    id: ID!
    displayName: String!
    avatarUrl: String
    profile: Profile
    bio: Bio
  }

  type Profile {
    id: ID!
    aboutMe: String
    age: Int
    gender: String
    city: String
    isComplete: Boolean!
    user: User
  }

  type Bio {
    id: ID!
    workoutTypes: [String!]!
    experienceLevel: String
    scheduleSlots: [String!]!
    goals: [String!]!
    lookingFor: [String!]!
    gymName: String
    intensity: String
    user: User
  }

  type Presence {
    online: Boolean!
    lastSeenAt: String
  }

  type AuthPayload {
    token: String!
    userId: ID!
  }

  type Message {
    id: ID!
    chatId: ID!
    senderId: ID!
    body: String!
    createdAt: String!
    readAt: String
  }

  type LastMessage {
    body: String!
    createdAt: String!
    senderId: ID!
  }

  type Chat {
    id: ID!
    otherId: ID!
    other: User
    lastMessage: LastMessage
    unreadCount: Int!
  }

  type ConnectionStatus {
    status: String!
  }

  type Query {
    user(id: ID!): User
    bio(id: ID!): Bio
    profile(id: ID!): Profile
    me: User
    myBio: Bio
    myProfile: Profile
    myEmail: String!
    recommendations: [User!]!
    connections: [User!]!
    incomingRequests: [User!]!
    outgoingRequests: [User!]!
    chats: [Chat!]!
    messages(chatId: ID!, limit: Int, before: String): [Message!]!
    unreadCount: Int!
    presence(id: ID!): Presence
  }

  type Mutation {
    register(email: String!, password: String!, displayName: String!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    logout: Boolean!
    updateMe(displayName: String!): Boolean!
    updateProfile(aboutMe: String, age: Int, gender: String, city: String): Boolean!
    updateBio(
      workoutTypes: [String!]
      experienceLevel: String
      scheduleSlots: [String!]
      goals: [String!]
      lookingFor: [String!]
      gymName: String
      intensity: String
    ): Boolean!
    deleteAvatar: Boolean!
    requestConnection(userId: ID!): ConnectionStatus!
    acceptConnection(userId: ID!): ConnectionStatus!
    declineConnection(userId: ID!): ConnectionStatus!
    disconnect(userId: ID!): Boolean!
    dismissRecommendation(userId: ID!): Boolean!
    sendMessage(chatId: ID!, body: String!): Message!
    markRead(chatId: ID!): Boolean!
  }
`;
