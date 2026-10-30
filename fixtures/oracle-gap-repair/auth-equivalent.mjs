export default (subject, record) => record.tenant === subject.tenant && subject.canExport ? 'ALLOW' : 'DENY';
