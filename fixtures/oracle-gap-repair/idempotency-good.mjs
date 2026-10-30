export default (state, operation) => {
  if (operation.amount <= 0) return {state, response: 'INVALID'};
  if (state.seen.includes(operation.id)) return {state, response: 'OK'};
  return {state: {balance: state.balance + operation.amount, seen: [...state.seen, operation.id]}, response: 'OK'};
};
