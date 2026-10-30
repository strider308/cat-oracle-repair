export default (state, operation) => operation.amount <= 0
  ? {state, response: 'INVALID'}
  : {state: {balance: state.balance + operation.amount, seen: state.seen}, response: 'OK'};
