describe('Payment E2E Tests', () => {
    let paymentService;
    let mockGateway;

    beforeEach(() => {
        mockGateway = {
            processPayment: jest.fn(),
            refund: jest.fn(),
            validateCard: jest.fn(),
        };
        paymentService = require('../src/paymentService')(mockGateway);
    });

    describe('Successful Payment Flow', () => {
        test('should process payment with valid card', async () => {
            mockGateway.processPayment.mockResolvedValue({
                transactionId: 'txn_123',
                status: 'success',
                amount: 99.99,
            });

            const result = await paymentService.pay({
                cardNumber: '4111111111111111',
                amount: 99.99,
                currency: 'USD',
            });

            expect(result.status).toBe('success');
            expect(mockGateway.processPayment).toHaveBeenCalled();
        });

        test('should return transaction ID on success', async () => {
            mockGateway.processPayment.mockResolvedValue({
                transactionId: 'txn_456',
                status: 'success',
            });

            const result = await paymentService.pay({
                cardNumber: '4111111111111111',
                amount: 50.00,
                currency: 'USD',
            });

            expect(result.transactionId).toBe('txn_456');
        });
    });

    describe('Payment Failures', () => {
        test('should reject invalid card', async () => {
            mockGateway.validateCard.mockResolvedValue(false);

            await expect(
                paymentService.pay({
                    cardNumber: 'invalid',
                    amount: 50.00,
                    currency: 'USD',
                })
            ).rejects.toThrow('Invalid card');
        });

        test('should handle payment gateway errors', async () => {
            mockGateway.processPayment.mockRejectedValue(
                new Error('Gateway timeout')
            );

            await expect(
                paymentService.pay({
                    cardNumber: '4111111111111111',
                    amount: 50.00,
                    currency: 'USD',
                })
            ).rejects.toThrow('Gateway timeout');
        });
    });

    describe('Refund Flow', () => {
        test('should refund successful payment', async () => {
            mockGateway.refund.mockResolvedValue({
                status: 'refunded',
                transactionId: 'txn_123',
            });

            const result = await paymentService.refund('txn_123');

            expect(result.status).toBe('refunded');
            expect(mockGateway.refund).toHaveBeenCalledWith('txn_123');
        });
    });
});