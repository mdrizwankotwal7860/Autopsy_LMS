process.env.JWT_SECRET = 'test-secret';
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  clearMocks: true,
};
