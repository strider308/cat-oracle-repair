export default (subject, record) => subject.canExport && subject.tenant === record.tenant ? 'ALLOW' : 'DENY';
