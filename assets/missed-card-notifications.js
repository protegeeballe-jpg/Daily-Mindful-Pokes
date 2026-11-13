/**
 * Identify checklist cards left incomplete on a day the user actually started.
 * Card 1 is complete after any location is selected; cards 2–6 require every
 * checkbox in that card to be checked.
 */
export function getMissedChecklistCards(dailyData, sectionDefinitions) {
    if (!dailyData || typeof dailyData !== 'object' || Array.isArray(dailyData)
        || !Array.isArray(sectionDefinitions) || !sectionDefinitions.length) {
        return [];
    }

    const dayWasStarted = Object.entries(dailyData).some(([key, value]) => {
        if (key === 'cloud_flow_version') return false;
        return value === true || (typeof value === 'string' && value.trim().length > 0);
    });
    if (!dayWasStarted) return [];

    return sectionDefinitions.reduce((missed, section) => {
        const ids = Array.isArray(section?.ids) ? section.ids.filter(id => typeof id === 'string' && id.length > 0) : [];
        if (!ids.length || !Number.isInteger(section?.number) || section.number < 1 || section.number > 6) return missed;

        const checked = ids.map(id => dailyData[id] === true);
        const completed = section.number === 1 ? checked.some(Boolean) : checked.every(Boolean);
        if (!completed) {
            missed.push({
                number: section.number,
                title: typeof section.title === 'string' ? section.title : 'Card ' + section.number
            });
        }
        return missed;
    }, []);
}
