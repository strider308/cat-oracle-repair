export default (state, operation) => {
  const duplicate = state.seen.includes(operation.id);
  if (operation.amount <= 0) return {state, response: 'INVALID'};
  return {state: duplicate ? state : {seen: state.seen.concat(operation.id), balance: state.balance + operation.amount}, response: 'OK'};
};
